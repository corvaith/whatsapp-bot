import { fileTypeFromBuffer } from 'file-type';

/**
 * File uploader. Both providers return a *raw* media URL (a direct
 * image/video/audio/file link, never an HTML viewer page).
 * Live-verified from this VPS: uguu, tmpfiles.
 */

async function prepare(buffer, filename) {
	const type = await fileTypeFromBuffer(buffer);
	const ext = type?.ext || 'bin';
	const mime = type?.mime || 'application/octet-stream';
	const name = filename || `file.${ext}`;
	return { name, ext, mime, blob: new Blob([buffer], { type: mime }) };
}

async function asJson(response) {
	const text = await response.text();
	try {
		return JSON.parse(text);
	} catch {
		throw new Error(`Unexpected response: ${text.slice(0, 200)}`);
	}
}

/** uguu.se (temporary ~48h, 1 GB). Returns a raw link. */
export async function uguu(buffer, filename) {
	const { blob, name } = await prepare(buffer, filename);
	const form = new FormData();
	form.append('files[]', blob, name);
	const res = await fetch('https://uguu.se/upload.php', { method: 'POST', body: form, signal: AbortSignal.timeout(120000) });
	const json = await asJson(res);
	if (!json?.files?.[0]?.url) throw new Error(`Uguu: ${JSON.stringify(json).slice(0, 200)}`);
	return json.files[0].url;
}

/**
 * tmpfiles.org (temporary, 1h). The API gives an HTML page URL; the raw file
 * link (with a signed token) only appears inside that page, so we fetch the
 * page and extract the direct /dl/<token>/<name> URL.
 */
export async function tmpfiles(buffer, filename) {
	const { name } = await prepare(buffer, filename);
	const form = new FormData();
	form.append('file', new File([buffer], name));
	const res = await fetch('https://tmpfiles.org/api/v1/upload', { method: 'POST', body: form, signal: AbortSignal.timeout(120000) });
	const json = await asJson(res);
	if (!json?.data?.url) throw new Error(`Tmpfiles: ${JSON.stringify(json).slice(0, 200)}`);
	const page = await fetch(json.data.url, { signal: AbortSignal.timeout(30000) });
	const html = await page.text();
	const raw = html.match(/https:\/\/tmpfiles\.org\/dl\/[^"'\s<>]+/)?.[0];
	if (!raw) throw new Error('Tmpfiles: raw download link not found on page.');
	return raw;
}

export const providers = { uguu, tmpfiles };

/** Providers tried in order when no provider is named; uguu is the default. */
export const defaultChain = ['uguu', 'tmpfiles'];

/**
 * Upload using a named provider. Without a provider, tries the default chain
 * until one succeeds.
 * @param {Buffer} buffer
 * @param {string} [filename]
 * @param {string} [provider]
 * @returns {Promise<string>} raw media URL
 */
export async function upload(buffer, filename, provider) {
	if (provider) {
		const fn = providers[provider];
		if (!fn) throw new Error(`Unknown provider: ${provider}.`);
		return fn(buffer, filename);
	}
	let lastError;
	for (const name of defaultChain) {
		try {
			return await providers[name](buffer, filename);
		} catch (err) {
			lastError = err;
		}
	}
	throw lastError || new Error('No upload provider succeeded.');
}
