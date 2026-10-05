import { guardUrl } from './net-guard.js';

/**
 * Native-fetch HTTP client with byte limits, manual redirects and SSRF guard.
 * @param {{ url: string, method?: string, headers?: Record<string,string>, body?: any,
 *          timeoutMs?: number, maxBytes?: number, maxRedirects?: number, guard?: boolean }} options
 * @returns {Promise<{ status: number, statusText: string, headers: Array<[string,string]>, buffer: Buffer, finalUrl: string, elapsedMs: number }>}
 */
export async function request({ url, method = 'GET', headers = {}, body, timeoutMs = 15000, maxBytes, maxRedirects = 5, guard = false }) {
	let currentUrl = url;
	let remainingRedirects = maxRedirects;
	const startedAt = Date.now();

	for (;;) {
		if (guard) {
			const error = await guardUrl(currentUrl);
			if (error) {
				const err = new Error(error);
				err.code = 'GUARD_BLOCKED';
				throw err;
			}
		}

		let response;
		try {
			response = await fetch(currentUrl, {
				method,
				headers,
				body: method === 'GET' || method === 'HEAD' ? undefined : body,
				redirect: 'manual',
				signal: AbortSignal.timeout(timeoutMs),
			});
		} catch (err) {
			if (err.name === 'TimeoutError' || err.name === 'AbortError') {
				const timeoutErr = new Error(`Request timed out after ${timeoutMs}ms.`);
				timeoutErr.code = 'ETIMEDOUT';
				throw timeoutErr;
			}
			const connErr = new Error('Failed to connect: the server is unreachable.');
			connErr.code = 'ECONNFAILED';
			connErr.cause = err;
			throw connErr;
		}

		if ([301, 302, 303, 307, 308].includes(response.status)) {
			const location = response.headers.get('location');
			if (!location) return finish(response, currentUrl, startedAt);
			if (remainingRedirects-- <= 0) {
				const err = new Error('Too many redirects.');
				err.code = 'EREDIRECTS';
				throw err;
			}
			response.body?.cancel();
			currentUrl = new URL(location, currentUrl).href;
			if (response.status === 303) {
				method = 'GET';
				body = undefined;
			}
			continue;
		}

		if (maxBytes !== undefined) {
			const contentLength = Number(response.headers.get('content-length') || 0);
			if (contentLength > maxBytes) {
				response.body?.cancel();
				const err = new Error(`Response too large (${(contentLength / 1048576).toFixed(1)} MB); the limit is ${(maxBytes / 1048576).toFixed(0)} MB.`);
				err.code = 'ETOOBIG';
				throw err;
			}
			if (!response.body) return finish(response, currentUrl, startedAt);
			const chunks = [];
			let total = 0;
			for await (const chunk of response.body) {
				total += chunk.length;
				if (total > maxBytes) {
					response.body?.cancel();
					const err = new Error(`Response too large (over ${(maxBytes / 1048576).toFixed(0)} MB).`);
					err.code = 'ETOOBIG';
					throw err;
				}
				chunks.push(Buffer.from(chunk));
			}
			return finish(response, currentUrl, startedAt, Buffer.concat(chunks));
		}

		return finish(response, currentUrl, startedAt, Buffer.from(await response.arrayBuffer()));
	}
}

function finish(response, finalUrl, startedAt, buffer = Buffer.alloc(0)) {
	return {
		status: response.status,
		statusText: response.statusText,
		headers: [...response.headers],
		buffer,
		finalUrl,
		elapsedMs: Date.now() - startedAt,
	};
}
