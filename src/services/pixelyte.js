import { config } from '#config/environment.js';

const REQUEST_TIMEOUT_MS = 120_000;

export const UPSCALE_MODELS = ['realesr_general_x4v3', 'realesrgan_x4plus', 'swinir_gan_x4'];
export const UPSCALE_ALIASES = { x4v3: 'realesr_general_x4v3', x4plus: 'realesrgan_x4plus', swinir: 'swinir_gan_x4' };
export const REMOVE_BACKGROUND_MODELS = ['u2netp', 'u2net', 'isnet_general_use', 'birefnet_general_lite'];
export const REMOVE_BACKGROUND_ALIASES = { isnet: 'isnet_general_use', birefnet: 'birefnet_general_lite' };
export const OCR_LANGUAGES = ['latin', 'chinese'];

/** Application-level error raised for any Pixelyte failure; stack traces stay in logs. */
export class PixelyteError extends Error {
	constructor(message, cause) {
		super(message);
		this.name = 'PixelyteError';
		this.cause = cause;
	}
}

/**
 * @param {string} path
 * @param {Buffer} [buffer] multipart upload; omit for JSON body mode
 * @param {string} [mime]
 * @param {Record<string, any>} [fields] extra multipart fields
 * @param {{ filename?: string, timeoutMs?: number, json?: Record<string, any> }} [options]
 */
async function requestJson(path, buffer, mime, fields = {}, options = {}) {
	const { filename = 'upload.jpg', timeoutMs = REQUEST_TIMEOUT_MS, json } = options;
	let init;
	if (json) {
		init = {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(json),
		};
	} else {
		const form = new FormData();
		form.append('file', new Blob([buffer], { type: mime }), filename);
		for (const [key, value] of Object.entries(fields)) {
			if (value !== undefined) form.append(key, value);
		}
		init = { method: 'POST', body: form };
	}

	let response;
	try {
		response = await fetch(`${config.pixelyte.baseUrl}${path}`, { ...init, signal: AbortSignal.timeout(timeoutMs) });
	} catch (err) {
		throw new PixelyteError('Pixelyte request failed: service unavailable.', err);
	}

	const body = await response.json().catch(() => null);
	if (!response.ok || !body?.success) {
		const message = body?.error?.message || `HTTP ${response.status}`;
		const err = new PixelyteError(message);
		err.status = response.status;
		throw err;
	}
	return body.data;
}

/**
 * Download a result URL with an optional byte limit enforced while streaming.
 * @param {string} url
 * @param {{ timeoutMs?: number, maxBytes?: number }} [options]
 */
async function downloadResult(url, options = {}) {
	const { timeoutMs = REQUEST_TIMEOUT_MS, maxBytes } = options;
	let response;
	try {
		response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
	} catch (err) {
		throw new PixelyteError('Pixelyte request failed: result download error.', err);
	}
	if (!response.ok) throw new PixelyteError(`Pixelyte request failed: result download HTTP ${response.status}`);

	const contentLength = Number(response.headers.get('content-length') || 0);
	if (maxBytes && contentLength > maxBytes) {
		response.body?.cancel();
		throw new PixelyteError(`Result too large (${(contentLength / 1048576).toFixed(1)} MB).`);
	}

	if (!maxBytes) return Buffer.from(await response.arrayBuffer());

	const chunks = [];
	let total = 0;
	for await (const chunk of response.body) {
		total += chunk.length;
		if (total > maxBytes) {
			response.body?.cancel();
			throw new PixelyteError(`Result too large (over ${(maxBytes / 1048576).toFixed(0)} MB).`);
		}
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

/**
 * Upscale an image.
 * @param {Buffer} buffer
 * @param {{mime?: string, model?: string}} [options]
 */
export async function upscale(buffer, options = {}) {
	const data = await requestJson('/api/upscale', buffer, options.mime || 'image/jpeg', { model: options.model });
	return { buffer: await downloadResult(data.url), meta: data };
}

/**
 * Remove an image background.
 * @param {Buffer} buffer
 * @param {{mime?: string, model?: string}} [options]
 */
export async function removeBackground(buffer, options = {}) {
	const data = await requestJson('/api/remove-bg', buffer, options.mime || 'image/jpeg', { model: options.model });
	return { buffer: await downloadResult(data.url), meta: data };
}

/**
 * Extract text from an image.
 * @param {Buffer} buffer
 * @param {{mime?: string, language?: string}} [options]
 */
export async function ocr(buffer, options = {}) {
	return requestJson('/api/ocr', buffer, options.mime || 'image/jpeg', { lang: options.language || 'latin' });
}

/**
 * Convert media between formats via the Pixelyte ffmpeg backend.
 * @param {Buffer | { url: string }} input file buffer (multipart) or URL source (JSON)
 * @param {{ to: string, mime?: string, filename?: string, timeoutMs?: number, maxOutputBytes?: number }} options
 * @returns {Promise<{ buffer: Buffer, meta: any }>}
 */
export async function convert(input, options) {
	const { to, mime, filename, timeoutMs = 180_000, maxOutputBytes } = options;
	let data;
	if (Buffer.isBuffer(input)) {
		data = await requestJson('/api/convert', input, mime || 'application/octet-stream', { to }, { filename, timeoutMs });
	} else {
		data = await requestJson('/api/convert', undefined, undefined, undefined, { json: { url: input.url, to }, timeoutMs });
	}
	return { buffer: await downloadResult(data.url, { timeoutMs, maxBytes: maxOutputBytes }), meta: data };
}
