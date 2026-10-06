/**
 * Album helper: send an albumMessage parent + associated media children.
 * Shared by .album and .stickerpack.
 *
 * Wire shape captured 1:1 from a REAL album sent by an official WhatsApp
 * client (owner capture via .albumdebug):
 * - parent: albumMessage {expectedImageCount, expectedVideoCount} + a
 *   messageContextInfo.messageSecret at the Message level.
 * - child: normal media message whose Message-level messageContextInfo holds
 *   BOTH messageSecret AND messageAssociation {MEDIA_ALBUM, parentMessageKey}.
 * - child contextInfo carries the chat's ephemeral settings.
 * - all media uploads run in PARALLEL, relays back-to-back, so the children
 *   arrive within the client's grouping window (real clients send instantly).
 *
 * CRITICAL (verified via wire diff): the child association's parentMessageKey
 * must carry the REAL parent id (a real album shows `A544D142…`, ours sent
 * `id: ""` and the client refused to group). Snapshot the key BEFORE relaying
 * and refuse to send if the id is missing.
 */
import crypto from 'crypto';
import { generateMessageIDV2, generateWAMessage, generateWAMessageFromContent, proto } from 'baileys';

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
	// The fork leaves key.id empty ("Rust generates the real message ID") — but
	// the children's association needs the REAL id on the wire, so set it here.
	const parentKey = { remoteJid: jid, fromMe: true, id: parentId };
	await conn.relayMessage(jid, parent.message, { messageId: parentKey.id });

	// Upload all media concurrently, then relay children back-to-back.
	const built = await Promise.all(
		items.map((item) =>
			generateWAMessage(
				jid,
				{ [item.mediaType]: item.buffer, ...(item.caption ? { caption: item.caption } : {}) },
				{ upload: conn.waUploadToServer },
			),
		),
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
