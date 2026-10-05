import { fileTypeFromBuffer } from 'file-type';
import { convert } from '#services/pixelyte.js';
import { PixelyteError } from '#services/pixelyte.js';
import { getMediaBuffer } from './_shared.js';
import { formatSize } from '#utils/format.js';
import { MAX_CONVERT_INPUT_BYTES, MAX_CONVERT_OUTPUT_BYTES, CONVERT_TIMEOUT_MS } from '#config/constants.js';

const URL_RE = /https?:\/\/[^\s<>"')\]]+/i;

const HELP = (prefix) =>
	`*${prefix}convert <format>* — reply to media, or send media with this caption\n` +
	`*${prefix}convert <format> <url>* — convert from a URL\n` +
	`*${prefix}convert* — show this help\n\n` +
	'Examples: `convert mp3` (reply to a video), `convert gif` (reply to an mp4), `convert png https://host/foto.webp`\n\n' +
	'Supported formats follow the API allowlist; image conversion is currently not enabled on the API.';

/** Max 2 concurrent conversions; 1 request / 10s cooldown per sender (owner exempt). */
let active = 0;
const lastHit = new Map();

function normalizeFormat(input) {
	const fmt = String(input || '')
		.toLowerCase()
		.replace(/^\.+/, '')
		.trim();
	return /^[a-z0-9]{1,10}$/.test(fmt) ? fmt : null;
}

async function uploadName(source) {
	if (source.filename) return source.filename;
	const type = await fileTypeFromBuffer(source.buffer).catch(() => null);
	const ext = type?.ext || (source.mime || '').split('/')[1]?.replace(/[^a-z0-9]/gi, '') || 'bin';
	return `upload.${ext}`;
}

export default {
	commands: ['convert', 'conv'],
	category: 'media',
	description: 'Convert media between formats via the Pixelyte API.',
	usage: '{prefix}convert <format> [url]\n{prefix}convert (reply to media)',
	react: '⏳',

	async run({ m, args, prefix, isOwner }) {
		const format = normalizeFormat(args[0]);
		if (!format) return m.reply(HELP(prefix));

		const url = m.text.slice(args[0].length).trim().match(URL_RE)?.[0] || m.text.match(URL_RE)?.[0];
		let source = null;
		if (!url) {
			source = await getMediaBuffer(m);
			if (!source) return m.reply(HELP(prefix));
			if (source.buffer.length > MAX_CONVERT_INPUT_BYTES) {
				await m.react('❌');
				return m.reply(`Media is too large (${formatSize(source.buffer.length)}); the limit is ${MAX_CONVERT_INPUT_BYTES / 1048576} MB.`);
			}
		}

		if (!isOwner) {
			const now = Date.now();
			const last = lastHit.get(m.sender) || 0;
			if (now - last < 10_000) {
				await m.react('❌');
				return m.reply('Cooldown: one conversion per 10 seconds.');
			}
			lastHit.set(m.sender, now);
		}
		if (active >= 2) return m.reply('Server is busy converting other media; try again in a moment.');
		active++;
		await m.react('⏳');
		const startedAt = Date.now();
		try {
			const input = url ? { url } : source.buffer;
			const filename = url ? undefined : await uploadName(source);
			const { buffer: result, meta } = await convert(input, {
				to: format,
				mime: source?.mime,
				filename,
				timeoutMs: CONVERT_TIMEOUT_MS,
				maxOutputBytes: MAX_CONVERT_OUTPUT_BYTES,
			});
			const type = await fileTypeFromBuffer(result).catch(() => null);
			const mime = type?.mime || '';
			const baseName = url ? url.split('/').pop().replace(/\.[a-z0-9]+$/i, '') : filename?.replace(/\.[a-z0-9]+$/i, '');
			const outName = `${baseName || 'converted'}.${format}`;
			const summary =
				`*Convert completed* ✅\n${meta.from || '?'} → ${format}\n` +
				`Size: ${formatSize(url ? 0 : source.buffer.length)}${url ? ' (URL)' : ''} → ${formatSize(result.length)}\n` +
				`Time: ${((Date.now() - startedAt) / 1000).toFixed(1)}s`;

			if (mime.startsWith('audio/')) await m.reply({ audio: result, mimetype: mime });
			else if (mime.startsWith('video/')) await m.reply({ video: result, caption: summary });
			else if (mime.startsWith('image/') && format !== 'gif') await m.reply({ image: result, caption: summary });
			else await m.reply({ document: result, mimetype: mime || 'application/octet-stream', fileName: outName, caption: summary });
			await m.react('✅');
		} catch (err) {
			await m.react('❌');
			const detail = err instanceof PixelyteError ? err.message : 'unexpected processing error';
			await m.reply(`Convert failed: ${detail}`);
		} finally {
			active--;
		}
	},
};
