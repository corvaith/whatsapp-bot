/**
 * .linkcard — forged link preview: title/description/thumbnail sent inline in
 * the extendedTextMessage, the way WhatsApp Web does it.
 */
import { request } from '#utils/http.js';
import { proto, generateWAMessageFromContent, generateMessageIDV2 } from 'baileys';

const FALLBACK_URL = 'https://nekos.best';

async function fetchOgImage(url) {
	try {
		const res = await request({ url, timeoutMs: 15000, maxBytes: 2 * 1024 * 1024 });
		if (res.status !== 200) return;
		const html = res.buffer.toString('utf8');
		const og =
			html.match(/property=["']og:image["'][^>]*content=["']([^"']+)/i) ||
			html.match(/content=["']([^"']+)["'][^>]*property=["']og:image["']/i) ||
			html.match(/<img[^>]+src=["']([^"']+\.(?:png|jpe?g|webp))/i);
		const img = og?.[1];
		if (!img) return;
		const imgUrl = img.startsWith('http') ? img : new URL(img, url).href;
		const imgRes = await request({ url: imgUrl, timeoutMs: 15000, maxBytes: 3 * 1024 * 1024 });
		if (imgRes.status === 200) return imgRes.buffer;
	} catch {}
}

const toJpegThumb = async (buffer) => {
	const { execFile } = await import('child_process');
	const { promisify } = await import('util');
	const { writeFile, readFile, unlink } = await import('fs/promises');
	const { tmpdir } = await import('os');
	const { join } = await import('path');
	const tmp = join(tmpdir(), `lc-${Date.now()}`);
	await writeFile(tmp, buffer);
	try {
		await promisify(execFile)('/usr/bin/ffmpeg', ['-y', '-i', tmp, '-vf', 'scale=720:720:force_original_aspect_ratio=decrease,pad=720:720:(ow-iw)/2:(oh-ih)/2', '-q:v', '4', `${tmp}.jpg`], {
			timeout: 30000,
		});
		return await readFile(`${tmp}.jpg`);
	} catch {
		return buffer;
	} finally {
		await unlink(`${tmp}.jpg`).catch(() => {});
		await unlink(tmp).catch(() => {});
	}
};

export default {
	commands: ['linkcard'],
	category: 'experimental',
	description: 'Send a forged link-preview message with picture. Usage: .linkcard Title | Description | https://url',
	usage: '{prefix}linkcard Title | Description | https://url',
	react: '🔗',

	async run(context) {
		const { m, conn, text } = context;
		const parts = (text || '').split('|').map((p) => p.trim());
		const title = parts[0] || 'Link';
		const url = parts.find((p, i) => i > 0 && p.startsWith('http')) || FALLBACK_URL;
		const description = parts.filter((p, i) => i > 0 && !p.startsWith('http') && p).join('\n');

		const rawThumb = await fetchOgImage(url);
		const jpegThumbnail = rawThumb ? await toJpegThumb(rawThumb) : undefined;

		const msg = generateWAMessageFromContent(
			m.chat,
			{
				extendedTextMessage: {
					text: `${title}\n${description ? description + '\n' : ''}${url}`,
					matchedText: url,
					description,
					title,
					previewType: 1,
					jpegThumbnail,
				},
			},
			{ userJid: conn.user.id, messageId: generateMessageIDV2(conn.user?.id) },
		);
		await conn.relayMessage(m.chat, msg.message, { messageId: msg.key.id });
	},
};
