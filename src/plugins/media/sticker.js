import { fileTypeFromBuffer } from 'file-type';
import { createSticker, isAnimated } from '#utils/media.js';
import { getMediaBuffer } from './mediaHelpers.js';
import { request } from '#utils/http.js';

const URL_RE = /https?:\/\/[^\s<>"')\]]+/i;
const EMOJI_RE = /(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F)(?:\u200D(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F))*/gu;
const MAX_STICKER_BYTES = 8 * 1024 * 1024;

const HELP = (prefix) =>
	`*${prefix}sticker* — make a sticker\n\n` +
	'• Reply/send an image or video (max 8 MB)\n' +
	'• Reply a sticker → repack\n' +
	'• `-wm pack|author` — custom watermark\n' +
	'• Single emoji → animated emoji sticker\n' +
	'• URL → download & convert\n\n' +
	'Alias: s, stiker';

async function fetchBuffer(url, maxBytes = MAX_STICKER_BYTES) {
	const res = await request({ url, timeoutMs: 30000, maxBytes });
	if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
	return res.buffer;
}

export default {
	commands: ['sticker', 's', 'stiker'],
	category: 'media',
	description: 'Create a sticker from image, video, emoji, URL, or sticker reply.',
	usage: '{prefix}sticker [-wm pack|author] (reply/send media, emoji, or URL)',
	react: '🎭',

	async run({ m, args, text, prefix }) {
		let pack = 'whatsapp-bot';
		let author = m.pushname || 'WhatsApp Bot';
		const wmIndex = args.indexOf('-wm');
		if (wmIndex !== -1 && args[wmIndex + 1]) {
			const [p, a] = args[wmIndex + 1].split('|').map((s) => s.trim());
			if (p) pack = p;
			if (a) author = a;
		}
		const send = async (buffer) => {
			const type = await fileTypeFromBuffer(buffer).catch(() => null);
			const mime = type?.mime || '';
			if (type && !/^image\//.test(mime) && !/^video\//.test(mime)) return null;
			const animated = isAnimated(buffer, mime);
			const sticker = await createSticker(buffer, { pack, author });
			await m.reply({ sticker, isAnimated: animated });
			await m.react('✅');
			return true;
		};

		try {
			const source = await getMediaBuffer(m);
			if (source && source.buffer.length <= MAX_STICKER_BYTES && (await send(source.buffer))) return;

			const clean = text.replace(/-wm\s+\S+/g, '').trim();

			const url = clean.match(URL_RE)?.[0];
			if (url && (await send(await fetchBuffer(url)))) return;

			const emojis = clean.match(EMOJI_RE);
			if (emojis?.length === 1 && emojis[0] === clean) {
				const cp = [...emojis[0]].map((c) => c.codePointAt(0).toString(16)).join('-');
				const buffer = await fetchBuffer(`https://fonts.gstatic.com/s/e/notoemoji/latest/${cp}/512.webp`).catch(() => null);
				if (!buffer) {
					await m.react('❌');
					return m.reply('Animated emoji not found.');
				}
				await send(buffer);
				return;
			}

			await m.react('❌');
			await m.reply(HELP(prefix));
		} catch (err) {
			await m.react('❌');
			await m.reply(`Sticker failed: ${err.message?.slice(0, 200) || 'unexpected error.'}`);
		}
	},
};
