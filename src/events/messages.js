import { format } from 'util';

import { handle } from '#core/dispatcher.js';

import printMessage from '#utils/message-logger.js';
import { serialize } from '#whatsapp/message/serialize.js';

import { unwrapSecretEncryptedMessage } from '#whatsapp/message/message-edit.js';

const MESSAGE_CACHE_MAX = 300;
const messageCache = new Map();

export const cacheMessage = (msg) => {
	const secret = msg?.message?.messageContextInfo?.messageSecret ?? msg?.messageContextInfo?.messageSecret;

	if (!msg?.key?.id || !secret) return;
	if (messageCache.has(msg.key.id)) messageCache.delete(msg.key.id);

	messageCache.set(msg.key.id, {
		key: msg.key,
		messageContextInfo: { messageSecret: Buffer.from(secret) },
	});

	if (messageCache.size > MESSAGE_CACHE_MAX) {
		const oldest = messageCache.keys().next().value;
		messageCache.delete(oldest);
	}
};

export const getMessage = async (key) => {
	return messageCache.get(key.id);
};

export default function (conn, registry) {
	conn.ev.on('messages.upsert', async ({ messages, type }) => {
		const raw = messages?.[0];
		if (!raw || !raw.message) return;

		// type 'notify' = pesan live; 'append'/'history' = backfill sync, di-skip.
		if (type && type !== 'notify') return;

		const end = conn.logger.time('messages.upsert');

		cacheMessage(raw);

		const isBotOwn = raw.key?.fromMe && raw.key?.id?.startsWith('3EB0');
		const isEdit = !!raw.message?.secretEncryptedMessage;
		if (isBotOwn && !isEdit) {
			end();
			return;
		}

		let m;
		try {
			if (isEdit) {
				await unwrapSecretEncryptedMessage(raw, { creds: conn.authState.creds, getMessage, logger: conn.logger });
			}

			m = await serialize(conn, raw);

			if (m.message) await printMessage(conn, m);
			await handle(conn, m, registry);
		} catch (e) {
			const text = format(e);
			conn.logger.error('Gagal memproses pesan:', e);
			try {
				m ??= await serialize(conn, raw);
				await m?.reply('Duar Meletuf : ' + text);
			} catch {}
		}
	});
}
