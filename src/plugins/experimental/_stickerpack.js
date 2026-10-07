/**
 * Helper: build + send a REAL WhatsApp StickerPackMessage (USER_CREATED):
 * stickers + tray zipped (store level 0) and uploaded as 'sticker-pack' media.
 */
import { createHash, createCipheriv, createHmac, hkdfSync, randomBytes } from 'crypto';
import { tmpdir } from 'os';
import { join } from 'path';
import { writeFile, readFile, unlink } from 'fs/promises';
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import { zipSync } from 'fflate';
import { proto, generateMessageIDV2, unixTimestampSeconds } from 'baileys';

const execFile = promisify(execFileCb);

/**
 * Encrypt a buffer the upstream Baileys way (AES-256-CBC + HMAC-SHA256 trunc 10),
 * with a custom HKDF info. The bridge's wasm upload enum lacks 'sticker-pack',
 * but its decrypt side has the Sticker Pack keys — content type, not transport
 * type, decides crypto.
 */
const mediaHKDF = (mediaKey, info) => {
	const derived = new Uint8Array(hkdfSync('sha256', Buffer.from(mediaKey), Buffer.alloc(32), info, 112));
	return {
		iv: derived.slice(0, 16),
		cipherKey: derived.slice(16, 48),
		macKey: derived.slice(48, 80),
	};
};

const encryptUpload = async (waClient, plaintext, info, uploadType) => {
	const mediaKey = randomBytes(32);
	const { iv, cipherKey, macKey } = mediaHKDF(mediaKey, info);
	const cipher = createCipheriv('aes-256-cbc', cipherKey, iv);
	const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
	const mac = createHmac('sha256', macKey).update(iv).update(ct).digest().subarray(0, 10);
	const enc = Buffer.concat([iv, ct, mac]);
	const fileSha256 = new Uint8Array(createHash('sha256').update(plaintext).digest());
	const fileEncSha256 = new Uint8Array(createHash('sha256').update(enc).digest());
	const getBody = () => {
		const bytes = enc.slice(); // fresh copy per upload attempt
		return new ReadableStream({
			start(controller) {
				controller.enqueue(new Uint8Array(bytes));
				controller.close();
			},
		});
	};
	const result = await waClient.uploadEncryptedMediaStream(getBody, mediaKey, fileSha256, fileEncSha256, plaintext.length, uploadType);
	return { ...result, fileSha256, fileEncSha256, mediaKey, fileLength: plaintext.length };
};

const isWebP = (b) => b.length >= 12 && b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP';
const isAnimatedWebP = (b) => {
	if (!isWebP(b)) return false;
	let o = 12;
	while (o < b.length - 8) {
		const tag = b.toString('ascii', o, o + 4);
		const size = b.readUInt32LE(o + 4);
		if (tag === 'VP8X' && b[o + 8] & 0x02) return true;
		if (tag === 'ANIM' || tag === 'ANMF') return true;
		o += 8 + size + (size % 2);
	}
	return false;
};

const toWebP512 = async (buffer, ext) => {
	const tmp = join(tmpdir(), `sp-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	await writeFile(tmp + (ext || '.png'), buffer);
	try {
		// animated webp needs a frame pipeline identical to the sticker command;
		// static input just rescales.
		const args = ['-y', '-i', tmp + (ext || '.png'), '-vf', 'scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2', '-lossless', '0', '-q:v', '80', tmp + '.webp'];
		await execFile('/usr/bin/ffmpeg', args, { timeout: 60000 });
		const out = await readFile(tmp + '.webp');
		await unlink(tmp + '.webp').catch(() => {});
		return out;
	} finally {
		await unlink(tmp + (ext || '.png')).catch(() => {});
	}
};

const toThumb252 = async (buffer, ext) => {
	const tmp = join(tmpdir(), `spt-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	await writeFile(tmp + (ext || '.png'), buffer);
	try {
		await execFile('/usr/bin/ffmpeg', ['-y', '-i', tmp + (ext || '.png'), '-vf', 'scale=252:252', '-q:v', '5', tmp + '.jpg'], { timeout: 60000 });
		const out = await readFile(tmp + '.jpg');
		await unlink(tmp + '.jpg').catch(() => {});
		return out;
	} finally {
		await unlink(tmp + (ext || '.png')).catch(() => {});
	}
};

/**
 * @param {object} conn WASocket (needs waUploadToServer + relayMessage)
 * @param {string} jid target chat
 * @param {{name?: string, publisher?: string, description?: string, cover: Buffer, coverExt?: string, stickers: Array<{data: Buffer, emojis?: string[]}>}} opts
 */
export async function sendStickerPack(conn, jid, opts) {
	const { cover, stickers, name = 'Sticker Pack', publisher = 'WhatsApp Bot', description = '' } = opts;
	if (!Buffer.isBuffer(cover)) throw new Error('Sticker pack cover buffer required');
	if (!stickers?.length) throw new Error('Sticker pack needs at least one sticker');

	const packId = generateMessageIDV2(conn.user?.id);
	const files = {};
	const stickerMeta = [];

	for (let i = 0; i < stickers.length; i++) {
		const { data, emojis } = stickers[i];
		const webp = isWebP(data) ? data : await toWebP512(data);
		if (webp.length > 1024 * 1024) throw new Error(`Sticker ${i} exceeds 1MB`);
		const hash = createHash('sha256').update(webp).digest('base64').replace(/\//g, '-');
		const fileName = `${String(i).padStart(2, '0')}_${hash}.webp`;
		files[fileName] = [new Uint8Array(webp), { level: 0 }];
		stickerMeta.push({
			fileName,
			mimetype: 'image/webp',
			isAnimated: isAnimatedWebP(webp),
			emojis: emojis?.length ? emojis : ['✨'],
			accessibilityLabel: '‎',
		});
	}

	const trayIconFileName = `${packId}.webp`;
	files[trayIconFileName] = [new Uint8Array(isWebP(cover) ? cover : await toWebP512(cover, opts.coverExt)), { level: 0 }];

	const zipBuf = Buffer.from(zipSync(files, { level: 0 }));
	const packUpload = await encryptUpload(conn.waClient, zipBuf, 'WhatsApp Sticker Pack Keys', 'document');

	const message = {
		name,
		publisher,
		packDescription: description,
		stickerPackId: packId,
		stickerPackOrigin: proto.Message.StickerPackMessage.StickerPackOrigin.USER_CREATED,
		stickerPackSize: zipBuf.length,
		stickers: stickerMeta,
		fileSha256: packUpload.fileSha256,
		fileEncSha256: packUpload.fileEncSha256,
		mediaKey: packUpload.mediaKey,
		directPath: packUpload.directPath,
		url: packUpload.url,
		fileLength: zipBuf.length,
		mediaKeyTimestamp: unixTimestampSeconds(),
		trayIconFileName,
	};

	try {
		const thumb = await toThumb252(cover, opts.coverExt);
		const thumbUpload = await encryptUpload(conn.waClient, thumb, 'WhatsApp Sticker Pack Thumbnail Keys', 'document');
		Object.assign(message, {
			thumbnailDirectPath: thumbUpload.directPath,
			thumbnailSha256: thumbUpload.fileSha256,
			thumbnailEncSha256: thumbUpload.fileEncSha256,
			thumbnailHeight: 252,
			thumbnailWidth: 252,
			imageDataHash: createHash('sha256').update(thumb).digest('base64'),
		});
	} catch {}

	const { generateWAMessageFromContent } = await import('baileys');
	const fullMsg = generateWAMessageFromContent(jid, { stickerPackMessage: message }, { messageId: generateMessageIDV2(conn.user?.id) });
	await conn.relayMessage(jid, fullMsg.message, { messageId: fullMsg.key.id });
	return fullMsg.key;
}
