import { fileTypeFromBuffer } from 'file-type';
import { request } from '#utils/http.js';
import { tokenize, splitOption } from '#utils/arguments.js';
import { truncate, formatSize } from '#utils/format.js';
import { MAX_FETCH_BYTES } from '#config.js';

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']);
const URL_RE = /https?:\/\/[^\s<>"')\]]+/i;

const HELP = (prefix) =>
	`*${prefix}fetch <url> [options]*\n\n` +
	'Options:\n' +
	'• `--method <M>` / `-X` — GET/POST/PUT/PATCH/DELETE (default GET)\n' +
	"• `--header 'K: V'` / `-H` — repeatable\n" +
	'• `--data <v>` / `-d` — repeatable; `{`/`[` starts a raw body, otherwise `k: v` or `k=v`\n' +
	'• `--json` — send fields as JSON (default urlencoded)\n' +
	'• `--head` / `-I` — status + headers only\n' +
	'• `--timeout <ms>` — default 15000, max 60000\n\n' +
	'You can also reply to a message containing a URL or a `curl` command.';

/** Cooldown: 3 requests / 8s per sender (owner exempt). */
const hits = new Map();
const WINDOW_MS = 8000;
const WINDOW_HITS = 3;

function underCooldown(sender, isOwner) {
	if (isOwner) return true;
	const now = Date.now();
	const list = (hits.get(sender) || []).filter((t) => now - t < WINDOW_MS);
	if (list.length >= WINDOW_HITS) return false;
	list.push(now);
	hits.set(sender, list);
	return true;
}

/** Parse tokens into request options. Returns { value } or { error }. */
export function parseOptions(tokens) {
	const options = { method: 'GET', headers: {}, fields: [], raw: [], json: false, head: false, timeoutMs: 15000, urls: [] };
	for (let i = 0; i < tokens.length; i++) {
		const [name, inline] = splitOption(tokens[i]);
		const take = () => inline ?? tokens[++i];
		switch (name) {
			case 'curl':
				break;
			case '--method':
			case '-X': {
				const value = String(take() || '').toUpperCase();
				if (!METHODS.has(value)) return { error: `Unknown method: ${value}` };
				options.method = value;
				break;
			}
			case '--header':
			case '-H': {
				const value = take();
				const idx = String(value).indexOf(':');
				if (idx < 1) return { error: `Invalid header: ${value} (expected 'Key: Value')` };
				options.headers[value.slice(0, idx).trim()] = value.slice(idx + 1).trim();
				break;
			}
			case '--data':
			case '-d':
				options.raw.push(String(take()));
				break;
			case '--json':
				options.json = true;
				break;
			case '--head':
			case '-I':
				options.head = true;
				break;
			case '--timeout': {
				const value = Number(take());
				if (!Number.isFinite(value) || value <= 0) return { error: 'Invalid --timeout value.' };
				options.timeoutMs = Math.min(value, 60000);
				break;
			}
			default:
				if (name.startsWith('-')) return { error: `Unknown option: ${name}` };
				options.urls.push(name);
		}
	}
	return { value: options };
}

function buildBody(options) {
	const raw = options.raw;
	if (!raw.length) return undefined;
	if (/^[[{]/.test(raw[0].trim())) return raw.map((s) => s.trim()).join(' ');
	const body = {};
	for (const item of raw) {
		const sep = item.includes(':') ? ':' : item.includes('=') ? '=' : null;
		if (!sep) return item;
		const idx = item.indexOf(sep);
		body[item.slice(0, idx).trim()] = item.slice(idx + 1).trim();
	}
	if (!options.json) return new URLSearchParams(body).toString();
	return undefined;
}

/** Format a JSON response for chat. */
function prettyJson(text) {
	try {
		return JSON.stringify(JSON.parse(text), null, 2);
	} catch {
		return null;
	}
}

function fileNameFrom(headers, url) {
	const disposition = headers.find(([k]) => k.toLowerCase() === 'content-disposition')?.[1] || '';
	const match = /filename="?([^";]+)"?/i.exec(disposition);
	if (match) return match[1];
	const path = new URL(url).pathname.split('/').filter(Boolean).pop();
	return path || 'response.bin';
}

export default {
	commands: ['fetch', 'get', 'http', 'curl'],
	category: 'tools',
	description: 'Make an HTTP request and get the response.',
	usage: "{prefix}fetch <url> [--method M] [--header 'K: V'] [--data v] [--json] [--head] [--timeout ms]",
	react: '🌐',

	async run({ m, rawText, text, quoted, isOwner }) {
		if (!underCooldown(m.sender, isOwner)) return m.reply('Rate limit: max 3 requests per 8 seconds.');

		const source = (rawText && rawText.trim()) || (text && URL_RE.test(text) && text) || '';
		const cleaned = source.replace(/^curl\s+/i, '').replace(/\\\n/g, ' ');
		const rawJsonMatch = /(?:--data|-d)\s+([\[{][\s\S]*)$/.exec(cleaned);
		const tokens = tokenize(rawJsonMatch ? cleaned.slice(0, rawJsonMatch.index) : cleaned);
		const parsed = parseOptions(tokens);
		if (parsed.error) return m.reply(`❌ ${parsed.error}\n\n${HELP(m.prefix)}`);
		const options = parsed.value;
		if (rawJsonMatch) {
			options.raw = [rawJsonMatch[1].trim()];
			options.urls = options.urls.filter((u) => /^https?:\/\//i.test(u) || !/^[[{\]}",:]/.test(u));
		}

		let target = options.urls.find((u) => /^https?:\/\//i.test(u)) || m.body.match(URL_RE)?.[0] || (m.isQuoted ? String(quoted?.body || '').match(URL_RE)?.[0] : null);
		if (!target) {
			const explicit = options.urls[0];
			if (explicit && !/^(https?:\/\/)/i.test(explicit)) return m.reply('❌ Only http and https URLs are allowed.');
			return m.reply(HELP(m.prefix));
		}

		if (options.head) options.method = 'HEAD';
		const headers = { ...options.headers };
		let body = buildBody(options);
		if (body !== undefined && body !== null && !options.json && /^[[{]/.test(String(body).trim())) {
			headers['content-type'] ||= 'application/json';
		} else if (options.json && options.raw.length && !/^[[{]/.test(options.raw[0].trim())) {
			headers['content-type'] ||= 'application/json';
			const obj = {};
			for (const item of options.raw) {
				const sep = item.includes(':') ? ':' : '=';
				const idx = item.indexOf(sep);
				if (idx > 0) obj[item.slice(0, idx).trim()] = item.slice(idx + 1).trim();
			}
			body = JSON.stringify(obj);
		} else if (body !== undefined && !headers['content-type'] && !/^[[{]/.test(String(body))) {
			headers['content-type'] ||= 'application/x-www-form-urlencoded';
		}
		if (body !== undefined && !headers['content-type']) headers['content-type'] = 'application/json';

		try {
			const res = await request({
				url: target,
				method: options.method,
				headers,
				body,
				timeoutMs: options.timeoutMs,
				maxBytes: MAX_FETCH_BYTES,
				guard: !isOwner,
			});
			const summary = `*${res.status} ${res.statusText || ''}* · ${formatSize(res.buffer.length)} · ${res.elapsedMs} ms`;
			await m.react('✅');

			if (options.method === 'HEAD') {
				const headerText = res.headers.map(([k, v]) => `${k}: ${v}`).join('\n');
				return m.reply(`${summary}\n\n\`\`\`\n${truncate(headerText, 4096)}\n\`\`\``);
			}

			const type = await fileTypeFromBuffer(res.buffer).catch(() => null);
			const contentType = (res.headers.find(([k]) => k.toLowerCase() === 'content-type')?.[1] || '').toLowerCase();
			const mime = type?.mime || contentType.split(';')[0].trim();

			if (mime.startsWith('image/')) return m.reply({ image: res.buffer, caption: summary });
			if (mime.startsWith('video/')) return m.reply({ video: res.buffer, caption: summary });
			if (mime.startsWith('audio/')) return m.reply({ audio: res.buffer, mimetype: mime });

			const asText = res.buffer.toString('utf8');
			const isTextual = /^(text\/|application\/(json|xml|javascript|xhtml))/i.test(contentType) || (type ? false : !/\0/.test(asText.slice(0, 4096)));
			if (isTextual) {
				const json = mime.includes('json') ? prettyJson(asText) : null;
				const shown = truncate(json || asText, 65536);
				const fenced = json ? `\`\`\`json\n${shown}\n\`\`\`` : `\`\`\`\n${shown}\n\`\`\``;
				return m.reply(`${summary}\n\n${fenced}`);
			}

			const name = fileNameFrom(res.headers, res.finalUrl);
			return m.reply({ document: res.buffer, mimetype: mime || 'application/octet-stream', fileName: name, caption: summary });
		} catch (err) {
			await m.react('❌');
			const messages = {
				GUARD_BLOCKED: err.message,
				ETIMEDOUT: err.message,
				ETOOBIG: err.message,
				ECONNFAILED: err.message,
				EREDIRECTS: err.message,
			};
			return m.reply(`❌ Fetch failed: ${messages[err.code] || 'unexpected error.'}`);
		}
	},
};
