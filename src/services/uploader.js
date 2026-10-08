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
 * direct.lunee.lol (LuneTool) - direct upload endpoint, no 100MB Cloudflare
 * limit. Anonymous works; X-API-Key (from lunee.lol) raises limits when
 * supplied via LUNEE_API_KEY. JSON response: {url (viewer), download_url
 * (raw file), short_url}. We return download_url (direct file link).
 */
export async function lunee(buffer, filename) {
	const { blob, name } = await prepare(buffer, filename);
	const form = new FormData();
	form.append('file', blob, name);
	const headers = {};
	if (process.env.LUNEE_API_KEY) headers['X-API-Key'] = process.env.LUNEE_API_KEY;
	const res = await fetch('https://direct.lunee.lol/api/upload', {
		method: 'POST',
		body: form,
		headers,
		signal: AbortSignal.timeout(180000),
	});
	const json = await asJson(res);
	const url = json?.download_url || json?.url;
	if (!json?.success || !url) throw new Error(`Lunee: ${JSON.stringify(json).slice(0, 200)}`);
	return url;
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

/**
 * top4top.io - persistent hosting (Arab file host), direct raw links of the
 * form https://e.top4top.io/p_<id>.<ext>. No public API: scrape the session
 * sid token from the homepage (cookie-bound), then multipart POST file_1_.
 */
export async function top4top(buffer, filename) {
	const { blob, name, mime } = await prepare(buffer, filename);
	const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36' };
	const home = await fetch('https://top4top.io/', { headers, signal: AbortSignal.timeout(30000) });
	const sidMatch = (await home.text()).match(/name="sid" value="([^"]*)"/);
	if (!sidMatch) throw new Error('Top4top: sid token not found.');
	const sid = decodeURIComponent(sidMatch[1]);
	const cookie =
		home.headers
			.getSetCookie?.()
			.map((c) => c.split(';')[0])
			.join('; ') || '';

	const form = new FormData();
	form.append('sid', sid);
	form.append('checkr', 'on');
	form.append('file_1_', blob, name);
	form.append('submitr', '[ رفع الملفات ]');
	const res = await fetch('https://top4top.io/index.php', {
		method: 'POST',
		body: form,
		headers: { ...headers, Cookie: cookie, Referer: 'https://top4top.io/', Origin: 'https://top4top.io' },
		signal: AbortSignal.timeout(180000),
	});
	const html = await res.text();
	const link = html.match(/https?:\/\/[a-z]\.top4top\.io\/p_[^"'<>\s]+/)?.[0];
	if (!link) throw new Error('Top4top: upload link not found in response.');
	return link;
}

export const providers = { uguu, tmpfiles, lunee, top4top };

/** Providers tried in order when no provider is named; uguu is the default. */
export const defaultChain = ['uguu', 'tmpfiles', 'lunee', 'top4top'];

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
