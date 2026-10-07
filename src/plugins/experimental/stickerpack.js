/**
 * Anime sticker pack: fetch images, build a REAL WhatsApp StickerPackMessage
 * (USER_CREATED pack zip uploaded as 'sticker-pack' media).
 */
import { request } from '#utils/http.js';

const CATEGORIES = ['neko', 'waifu', 'hug', 'kiss', 'poke', 'smile', 'wave', 'happy', 'noddle'];

export default {
	commands: ['stickerpack'],
	category: 'experimental',
	description: 'Send a native WhatsApp sticker pack of anime stickers. Usage: .stickerpack [category] [count 3-10]',
	usage: '{prefix}stickerpack [neko|waifu|hug|kiss|poke|smile|wave|happy|noddle] [count 3-10]',
	react: '📦',

	async run(context) {
		const { m, conn, text } = context;
		const [categoryRaw, countRaw] = (text || '').trim().split(/\s+/);
		const category = CATEGORIES.includes((categoryRaw || '').toLowerCase()) ? categoryRaw.toLowerCase() : 'waifu';
		const count = Math.min(Math.max(parseInt(countRaw, 10) || 5, 3), 10);

		const res = await request({
			url: `https://nekos.best/api/v2/${category}?amount=${count}`,
			timeoutMs: 15000,
			maxBytes: 1024 * 1024,
		});
		if (res.status !== 200) throw new Error(`nekos.best HTTP ${res.status}`);
		const data = JSON.parse(res.buffer.toString('utf8'));
		const results = (data.results || []).filter((r) => r.url);
		if (!results.length) return m.reply('No images returned by the API, try again.');

		const stickers = [];
		for (const r of results) {
			try {
				const img = await request({ url: r.url, timeoutMs: 30000, maxBytes: 15 * 1024 * 1024 });
				if (img.status === 200) stickers.push({ data: img.buffer, emojis: ['✨'] });
			} catch {
			}
		}
		if (!stickers.length) return m.reply('All sticker downloads failed, try again.');

		const { sendStickerPack } = await import('./_stickerpack.js');
		const cover = stickers[0].data;
		await sendStickerPack(conn, m.chat, {
			name: `${category.charAt(0).toUpperCase() + category.slice(1)} Pack`,
			publisher: m.pushname || 'WhatsApp Bot',
			description: 'Anime sticker pack',
			cover,
			coverExt: category === 'neko' || results[0].url.endsWith('.png') ? '.png' : '.jpg',
			stickers,
		});
	},
};
