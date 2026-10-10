import crypto from 'crypto';
import { execFile } from 'child_process';
import { generateWAMessage, generateWAMessageContent, generateWAMessageFromContent, generateMessageIDV2, prepareWAMessageMedia, proto } from 'baileys';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { request } from '#utils/http.js';
import { analyzeAudio } from '#utils/media.js';
import { repacketizeOggOpusToCode3 } from '#utils/media.js';
/**
 * Send an albumMessage parent with associated media children; wire shape
 * captured from a real official-client album.
 */

/**
 * Send an album: one albumMessage parent + media children associated to it.
 * @param {object} conn WASocket
 * @param {string} jid target chat
 * @param {Array<{buffer: Buffer, mediaType: 'image'|'video', caption?: string}>} items
 * @param {number} [expiration] ephemeral expiration of the chat, if any
 */
export async function sendAlbum(conn, jid, items, expiration = 0) {
	if (!items.length) throw new Error('Album needs at least one item');
	const imageCount = items.filter((i) => i.mediaType === 'image').length;
	const videoCount = items.length - imageCount;

	const parentId = generateMessageIDV2(conn.user?.id);
	const parent = generateWAMessageFromContent(
		jid,
		{
			messageContextInfo: { messageSecret: crypto.randomBytes(32) },
			albumMessage: {
				expectedImageCount: imageCount,
				expectedVideoCount: videoCount,
			},
		},
		{ messageId: parentId },
	);
	const parentKey = { remoteJid: jid, fromMe: true, id: parentId };
	await conn.relayMessage(jid, parent.message, { messageId: parentKey.id });

	const built = await Promise.all(
		items.map((item) => generateWAMessage(jid, { [item.mediaType]: item.buffer, ...(item.caption ? { caption: item.caption } : {}) }, { upload: conn.waUploadToServer })),
	);

	for (const img of built) {
		img.message.messageContextInfo = {
			messageSecret: crypto.randomBytes(32),
			messageAssociation: {
				associationType: proto.MessageAssociation.AssociationType.MEDIA_ALBUM,
				parentMessageKey: parentKey,
			},
		};
		if (expiration) {
			const mediaKey = Object.keys(img.message).find((k) => k === 'imageMessage' || k === 'videoMessage');
			img.message[mediaKey].contextInfo = {
				...img.message[mediaKey].contextInfo,
				expiration,
				disappearingMode: { initiator: 1, trigger: 0 },
			};
		}
		await conn.relayMessage(jid, img.message, { messageId: img.key.id });
	}
	return parentKey;
}

/**
 * Anime image album from nekos.best.
 */

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

export const album = {
	commands: ['album'],
	category: 'experimental',
	description: 'Send an anime image album (categories: neko, waifu, hug, kiss, ...)',
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

		await sendAlbum(conn, m.chat, items);
	},
};

/**
 * Send a WhatsApp Live Photo (motion photo): paired image + short video,
 * recipe matched against elynn-baileys generateWAMotionPhotoMessages.
 */
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

export const photolive = {
	commands: ['photolive'],
	category: 'experimental',
	description: 'Turn a short video into a live photo. Attach the video with as caption (or reply to one).',
	usage: '{prefix}photolive (attach a video with this as caption, or reply to a video)',
	react: '\u{1F5BC}\uFE0F',

	async run(context) {
		const { m, conn, downloadMedia } = context;
		const source = m.isQuoted ? m.quoted : m;
		const mime = source?.msg?.mimetype || '';
		if (!source?.isMedia || !mime.startsWith('video/')) {
			return m.reply(`How to use:\n1. Attach a short video (\u22646s)\n2. Put ${m.prefix}livephoto as the caption\n\nOr reply to an existing video with ${m.prefix}livephoto.`);
		}
		const videoBuffer = await downloadMedia();

		const dir = await mkdtemp(join(tmpdir(), 'livephoto-'));
		try {
			const frame = join(dir, 'still.jpg');
			const input = join(dir, 'input');
			await writeFile(input, videoBuffer);
			await new Promise((resolve, reject) => {
				execFile('ffmpeg', ['-y', '-i', input, '-frames:v', '1', '-q:v', '2', frame], { timeout: 30000 }, (err) => (err ? reject(err) : resolve()));
			}).catch(() => {});
			let imageBuffer;
			try {
				imageBuffer = await readFile(frame);
			} catch {
				imageBuffer = videoBuffer;
			}

			const probe = await new Promise((resolve) => {
				execFile('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,duration', '-of', 'json', input], { timeout: 15000 }, (err, stdout) =>
					resolve(err ? null : stdout),
				);
			});
			let seconds;
			let width;
			let height;
			try {
				const info = JSON.parse(probe).streams?.[0] || {};
				seconds = Math.max(1, Math.round(Number(info.duration) || 1));
				width = info.width;
				height = info.height;
			} catch {
				seconds = undefined;
			}

			const { imageMessage } = await prepareWAMessageMedia({ image: imageBuffer }, { upload: conn.waUploadToServer });
			const { videoMessage } = await prepareWAMessageMedia(
				{ video: videoBuffer, ...(seconds ? { seconds } : {}), ...(width ? { width, height } : {}), ...(imageMessage.jpegThumbnail ? { jpegThumbnail: imageMessage.jpegThumbnail } : {}) },
				{ upload: conn.waUploadToServer },
			);

			const parent = {
				imageMessage: {
					...imageMessage,
					contextInfo: { pairedMediaType: proto.ContextInfo.PairedMediaType.MOTION_PHOTO_PARENT },
				},
			};
			const parentKey = { remoteJid: m.chat, fromMe: true, id: generateMessageIDV2(conn.user?.id) };
			await conn.relayMessage(m.chat, parent, { messageId: parentKey.id });

			await delay(250);

			const child = {
				videoMessage: {
					...videoMessage,
					motionPhotoPresentationOffsetMs: 350,
					contextInfo: { pairedMediaType: proto.ContextInfo.PairedMediaType.MOTION_PHOTO_CHILD },
				},
				messageContextInfo: {
					messageAssociation: {
						associationType: proto.MessageAssociation.AssociationType.MOTION_PHOTO,
						parentMessageKey: parentKey,
					},
				},
			};
			await conn.relayMessage(m.chat, child, { messageId: generateMessageIDV2(conn.user?.id) });
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	},
};

/**
 * Send a video note (circular "bullet" message) from a video.
 */
export const ptv = {
	commands: ['ptv'],
	category: 'experimental',
	description: 'Send a video as a circular video note (ptv).',
	usage: '{prefix}ptv (reply to a video or attach with caption)',

	async run(context) {
		const { m, quoted, downloadMedia } = context;
		const source = m.isQuoted ? m.quoted : m;
		if (!source?.isMedia || !(source?.msg?.mimetype || '').startsWith('video/')) {
			return m.reply('Send or reply to a video with .ptv (mp4/webm).');
		}
		const buffer = await downloadMedia();
		await m.reply({ video: buffer, ptv: true, caption: undefined });
	},
};

/**
 * Send a voice note (ptt) — converts any audio/video input to opus ogg with a
 * rendered waveform and explicit duration (iPhone shows both correctly).
 */
export const ptt = {
	commands: ['ptt'],
	category: 'experimental',
	description: 'Send audio as a WhatsApp voice note (push to talk).',
	usage: '{prefix}ptt (reply to audio/video or attach with caption)',
	react: '🎙️',

	async run(context) {
		const { m, quoted, downloadMedia, conn } = context;
		const source = m.isQuoted ? m.quoted : m;
		if (!source?.isMedia) return m.reply('Send or reply to an audio/video with .ptt');

		const buffer = await downloadMedia();
		const dir = await mkdtemp(join(tmpdir(), 'ptt-'));
		const input = join(dir, 'input');
		const output = join(dir, 'out.ogg');
		try {
			await writeFile(input, buffer);
			await new Promise((resolve, reject) => {
				execFile('ffmpeg', ['-y', '-vn', '-i', input, '-avoid_negative_ts', 'make_zero', '-ac', '1', '-c:a', 'libopus', output], { timeout: 60000 }, (err) => (err ? reject(err) : resolve()));
			});
			const ogg = await readFile(output);
			const playable = repacketizeOggOpusToCode3(ogg);
			const { waveform, seconds } = await analyzeAudio(playable);
			await m.reply(
				{ audio: playable, mimetype: 'audio/ogg; codecs=opus', ptt: true },
				{
					processMedia: async (buf, mediaType, waClient) => ({
						upload: waClient ? await waClient.uploadMedia(buf, mediaType) : await conn.waUploadToServer(buf, { mediaType }),
						metadata: { waveform, seconds },
					}),
				},
			);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	},
};

export default [album, photolive, ptv, ptt];
