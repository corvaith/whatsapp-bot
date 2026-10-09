import { createHash, randomBytes } from 'crypto';
import { existsSync } from 'fs';
import { mkdir, unlink, writeFile } from 'fs/promises';
import { join } from 'path';
import { execFile } from 'child_process';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';

import { savedMessages } from '#services/storage.js';
import { toLid } from './usersJid.js';
import { analyzeAudio } from '#utils/media.js';
import { repacketizeOggOpusToCode3 } from '#utils/media.js';

const toOpusOgg = async (buf) => {
	const dir = await mkdtemp(join(tmpdir(), 'saved-'));
	const input = join(dir, 'in');
	const output = join(dir, 'out.ogg');
	try {
		await writeFile(input, buf);
		await new Promise((resolve, reject) => {
			execFile('ffmpeg', ['-y', '-vn', '-i', input, '-avoid_negative_ts', 'make_zero', '-ac', '1', '-c:a', 'libopus', output], { timeout: 60000 }, (err) => (err ? reject(err) : resolve()));
		});
		return await readFile(output);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
};

export const MAX_SAVED_MEDIA_BYTES = 50 * 1024 * 1024;
const SAVED_DIR = 'data/saved';

const MEDIA_EXT = {
	'image/jpeg': 'jpg',
	'image/png': 'png',
	'image/webp': 'webp',
	'image/gif': 'gif',
	'video/mp4': 'mp4',
	'audio/ogg': 'ogg',
	'audio/mpeg': 'mp3',
	'audio/mp4': 'm4a',
	'application/pdf': 'pdf',
};

const mimeFromBuffer = async (buf) => {
	const { fileTypeFromBuffer } = await import('file-type');
	const ft = await fileTypeFromBuffer(buf);
	return ft ? { mime: ft.mime, ext: ft.ext } : { mime: 'application/octet-stream', ext: 'bin' };
};

export const get = (id) => savedMessages.get(id);

export function findByKeyword(chatId, keyword) {
	return savedMessages.list().find((s) => s.chatId === chatId && s.keyword === keyword);
}

export function listForChat(chatId) {
	return savedMessages.list().filter((s) => s.chatId === chatId);
}

const genId = () => {
	for (;;) {
		const id = 'SM-' + randomBytes(2).toString('hex').toUpperCase();
		if (!savedMessages.get(id)) return id;
	}
};

/**
 * Persist one quoted message for replay: metadata in SQLite, media bytes on
 * disk under data/saved/. Cleans up the written file if the DB insert fails.
 */
export async function save({ chatId, ownerId, m }) {
	ownerId = toLid(ownerId);
	const type = m.quoted?.type ?? m.type;
	const payload = {};

	if (type === 'conversation' || type === 'extendedTextMessage') {
		payload.text = m.quoted?.body ?? '';
	} else if (m.quoted?.isMedia || m.quoted?.msg?.documentMessage) {
		let buf = await m.quoted.download();
		if (!buf?.length) throw new Error('Could not download the quoted media.');
		if (buf.length > MAX_SAVED_MEDIA_BYTES) throw new Error(`Media too large (max ${Math.floor(MAX_SAVED_MEDIA_BYTES / 1024 / 1024)} MB).`);

		const q = m.quoted;
		const forcePtt = type === 'audioMessage' || type === 'videoMessage' || type === 'pttMessage';
		if (forcePtt) {
			buf = await toOpusOgg(buf);
		}
		const declaredMime = q.msg?.mimetype;
		const sniffed = await mimeFromBuffer(buf);
		const declaredFamily = declaredMime?.split('/')[0];
		const sniffedFamily = sniffed.mime?.split('/')[0];
		const mime = declaredMime && declaredFamily === sniffedFamily ? declaredMime : sniffed.mime;
		const ext = MEDIA_EXT[sniffed.mime] ?? sniffed.ext;

		const id = genId();
		const dir = join(process.cwd(), SAVED_DIR);
		await mkdir(dir, { recursive: true });
		const mediaPath = join(SAVED_DIR, `${id}.${ext}`);
		await writeFile(join(process.cwd(), mediaPath), buf);

		payload.mediaKey = q.msg?.mediaKey ?? undefined;
		payload.caption = q.msg?.caption ?? undefined;
		payload.fileName = q.msg?.fileName ?? q.msg?.title ?? undefined;
		payload.ptt = !!forcePtt || !!q.msg?.ptt;
		payload.asSticker = type === 'stickerMessage';

		const entry = {
			id,
			keyword: null,
			chatId,
			ownerId,
			messageType: type,
			payload: JSON.stringify(payload),
			mediaPath,
			mimeType: mime,
		};
		try {
			savedMessages.upsert({ ...entry, keyword: '' });
		} catch (err) {
			await unlink(join(process.cwd(), mediaPath)).catch(() => {});
			throw err;
		}
		return entry;
	} else if (type === 'locationMessage') {
		payload.location = { degreesLatitude: m.quoted.msg?.degreesLatitude, degreesLongitude: m.quoted.msg?.degreesLongitude, name: m.quoted.msg?.name, address: m.quoted.msg?.address };
	} else if (type === 'contactMessage' || type === 'contactsArrayMessage') {
		payload.vcard = m.quoted.msg?.vcard;
	} else {
		return null;
	}

	const entry = {
		id: genId(),
		keyword: '',
		chatId,
		ownerId,
		messageType: type,
		payload: JSON.stringify(payload),
		mediaPath: null,
		mimeType: null,
	};
	savedMessages.upsert(entry);
	return entry;
}

export function setKeyword(id, keyword) {
	const entry = savedMessages.get(id);
	if (!entry) return;
	savedMessages.upsert({ ...entry, keyword });
}

/** Shared PTT send path: code-3 repacketization + waveform/duration metadata. */
export async function sendVoiceNote({ conn, m, ogg }) {
	const playable = repacketizeOggOpusToCode3(ogg);
	const { waveform, seconds } = await analyzeAudio(playable);
	return m.reply(
		{ audio: playable, mimetype: 'audio/ogg; codecs=opus', ptt: true },
		{
			processMedia: async (buf, mediaType, waClient) => ({
				upload: waClient ? await waClient.uploadMedia(buf, mediaType) : await conn.waUploadToServer(buf, { mediaType }),
				metadata: { waveform, seconds },
			}),
		},
	);
}

/** Remove a saved message and its media file; returns true when a row was deleted. */
export async function remove(id) {
	const entry = savedMessages.get(id);
	if (!entry) return false;
	savedMessages.remove(id);
	if (entry.mediaPath) {
		const p = join(process.cwd(), entry.mediaPath);
		if (existsSync(p)) await unlink(p).catch(() => {});
	}
	return true;
}

/** Replay a saved entry back into the chat it was saved from. */
export async function replay(entry, m, conn) {
	const payload = JSON.parse(entry.payload || '{}');

	if (entry.mediaPath) {
		const buf = await readFile(join(process.cwd(), entry.mediaPath));

		if (entry.messageType === 'stickerMessage') {
			return m.reply({ sticker: buf });
		}

		const kind = entry.mimeType?.startsWith('video/') ? 'video' : entry.mimeType?.startsWith('audio/') ? 'audio' : entry.mimeType?.startsWith('image/') ? 'image' : 'document';

		if (kind === 'audio') {
			const ogg = /audio\/(ogg|opus)/.test(entry.mimeType ?? '') ? buf : await toOpusOgg(buf);
			return sendVoiceNote({ conn, m, ogg });
		}

		const base = { [kind]: buf };
		if (payload.caption) base.caption = payload.caption;
		if (kind === 'document') {
			base.fileName = payload.fileName ?? entry.id;
			base.mimetype = entry.mimeType;
		}
		return m.reply(base);
	}

	switch (entry.messageType) {
		case 'conversation':
		case 'extendedTextMessage':
			return m.reply(payload.text ?? '');
		case 'stickerMessage':
			return m.reply({ sticker: await readFile(join(process.cwd(), entry.mediaPath)) });
		case 'locationMessage': {
			const l = payload.location ?? {};
			return conn.sendMessage(m.chat, { location: { degreesLatitude: l.degreesLatitude, degreesLongitude: l.degreesLongitude, name: l.name, address: l.address } }, { quoted: m });
		}
		case 'contactMessage':
		case 'contactsArrayMessage':
			return conn.sendMessage(m.chat, { contacts: { displayName: payload.vcard?.match(/FN:(.+)/)?.[1]?.trim() ?? 'Contact', contacts: [{ vcard: payload.vcard }] } }, { quoted: m });
		default:
			return m.reply('This saved message type is no longer supported.');
	}
}

export const hashOf = (buf) => createHash('sha256').update(buf).digest('hex');
