/**
 * Anime image album from nekos.best.
 */
import { request } from '#utils/http.js';

const CATEGORIES = ['neko', 'waifu', 'hug', 'kiss', 'poke', 'smile', 'wave', 'happy', 'noddle'];

async function fetchAnimeImages(category, count) {
	const res = await request({
		url: `https://nekos.best/api/v2/${category || 'waifu'}?amount=${Math.min(count, 10)}`,
		timeoutMs: 15000,
		maxBytes: 1024 * 1024,
	});
	if (res.status !== 200) throw new Error(`nekos.best HTTP ${res.status}`);
	const data = JSON.parse(res.buffer.toString('utf8'));
	return (data.results || []).map((r) => r.url).filter(Boolean);
}

async function downloadImage(url) {
	const res = await request({ url, timeoutMs: 30000, maxBytes: 15 * 1024 * 1024 });
	if (res.status !== 200) throw new Error(`HTTP ${res.status} for image`);
	return res.buffer;
}

export default {
	commands: ['album'],
	category: 'experimental',
	description: 'Send an anime image album. Usage: .album [category] [count 1-10] (categories: neko, waifu, hug, kiss, ...)',
	usage: '{prefix}album [neko|waifu|hug|kiss|poke|smile|wave|happy|noddle] [count]',
	react: '📃',

	async run(context) {
		const { m, conn, text } = context;
		const [categoryRaw, countRaw] = (text || '').trim().split(/\s+/);
		const category = CATEGORIES.includes((categoryRaw || '').toLowerCase()) ? categoryRaw.toLowerCase() : 'waifu';
		const count = Math.min(Math.max(parseInt(countRaw, 10) || 3, 1), 10);

		const urls = await fetchAnimeImages(category, count);
		if (!urls.length) return m.reply('No images returned by the API, try again.');

		const items = [];
		for (const url of urls) {
			try {
				const buffer = await downloadImage(url);
				items.push({ buffer, mediaType: url.endsWith('.gif') ? 'video' : 'image' });
			} catch {}
		}
		if (!items.length) return m.reply('All image downloads failed, try again.');

		const { sendAlbum } = await import('./_album.js');
		await sendAlbum(conn, m.chat, items);
	},
};
