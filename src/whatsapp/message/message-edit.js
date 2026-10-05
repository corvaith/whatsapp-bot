import { jidNormalizedUser, normalizeMessageContent, proto, aesDecryptGCM, hmacSign } from 'baileys';

export function decryptMessageEdit({ encPayload, encIv }, { origMsgId, origMsgSenderJid, editorJid, msgEncKey }) {
	if (typeof msgEncKey === 'string') msgEncKey = Buffer.from(msgEncKey, 'base64');
	if (!encPayload || !encIv || !msgEncKey) {
		throw new Error('Missing data required to decrypt secretEncryptedMessage');
	}

	// HKDF manual: extract (salt kosong 32-byte) -> expand (info + counter byte)
	const info = Buffer.concat([Buffer.from(origMsgId), Buffer.from(origMsgSenderJid), Buffer.from(editorJid), Buffer.from('Message Edit'), Buffer.from([1])]);
	const prk = hmacSign(msgEncKey, new Uint8Array(32), 'sha256');
	const decKey = hmacSign(info, prk, 'sha256');

	const decrypted = aesDecryptGCM(encPayload, decKey, encIv, new Uint8Array(0));
	return proto.Message.decode(decrypted);
}

export const unwrapSecretEncryptedMessage = async (message, { creds, getMessage, logger }) => {
	const content = normalizeMessageContent(message.message);
	const secretEnc = content?.secretEncryptedMessage;
	const targetKey = secretEnc?.targetMessageKey;

	const isEdit = secretEnc?.secretEncType === proto.Message.SecretEncryptedMessage.SecretEncType.MESSAGE_EDIT;
	if (!secretEnc?.encPayload || !secretEnc.encIv || !isEdit || !targetKey?.id) return;

	try {
		const origMsg = await getMessage({
			...targetKey,
			remoteJid: message.key.remoteJid,
			fromMe: message.key.fromMe,
			participant: message.key.participant,
		});
		if (!origMsg) {
			logger?.warn({ targetKey }, 'message edit: original message not found via getMessage');
			return;
		}

		let msgEncKey = origMsg?.message?.messageContextInfo?.messageSecret ?? origMsg?.messageContextInfo?.messageSecret;
		if (typeof msgEncKey === 'string') msgEncKey = Buffer.from(msgEncKey, 'base64');
		if (!msgEncKey?.length) {
			logger?.warn({ targetKey }, 'message edit: missing messageSecret for decryption');
			return;
		}

		const meId = jidNormalizedUser(creds.me.id);
		const ownCandidates = message.key.fromMe ? [meId, creds.me.lid] : [message.key.participant || message.key.remoteJid, message.key.participantAlt || message.key.remoteJidAlt];

		// coba tiap kandidat JID pengirim sampai ada yang berhasil didekripsi
		const normalizedJids = [...ownCandidates, targetKey.remoteJid].filter(Boolean).map((jid) => jidNormalizedUser(jid));
		const candidates = [...new Set(normalizedJids)];

		let decoded, lastError;
		for (const authorJid of candidates) {
			try {
				decoded = decryptMessageEdit(secretEnc, {
					origMsgId: targetKey.id,
					origMsgSenderJid: authorJid,
					editorJid: authorJid,
					msgEncKey,
				});
				break;
			} catch (err) {
				lastError = err;
			}
		}
		if (!decoded) throw lastError;

		if (!decoded.protocolMessage) {
			decoded = proto.Message.fromObject({
				protocolMessage: {
					key: targetKey,
					type: proto.Message.ProtocolMessage.Type.MESSAGE_EDIT,
					editedMessage: decoded,
				},
			});
		}

		if (!decoded.messageContextInfo && content?.messageContextInfo) {
			decoded.messageContextInfo = content.messageContextInfo;
		}

		message.message = decoded;
		logger?.debug({ targetKey }, 'decrypted secretEncryptedMessage edit');
	} catch (err) {
		logger?.warn({ err, targetKey }, 'failed to decrypt secretEncryptedMessage edit');
	}
};
