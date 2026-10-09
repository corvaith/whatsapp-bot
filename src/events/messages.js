import { format } from 'util';

import { decryptPollVote } from 'baileys/lib/Utils/process-message.js';
import { jidNormalizedUser } from 'baileys/lib/WABinary/index.js';

import { handle } from '#core/dispatcher.js';
import { getPoll, resolveCommand } from '#services/poll-vote.js';

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

/** Handle a poll vote update against a registered pollcmd poll. */
async function handlePollVote(conn, raw) {
	const update = raw.message?.pollUpdateMessage;
	if (!update) return;
	const creationKey = update.pollCreationMessageKey;
	const entry = getPoll(creationKey?.id);
	if (!entry) return;

	const voteKey = raw.key;
	const { decryptPollVotePayload } = await import('@oxidezap/whatsapp-rust-bridge');

	const creatorIds = [conn.user?.id, jidNormalizedUser(conn.user?.id ?? ''), conn.user?.lid, jidNormalizedUser(conn.user?.lid ?? '')].filter(Boolean);
	const voterIds = [voteKey?.participant, voteKey?.remoteJid, ...creatorIds].filter(Boolean);

	let vote;
	for (const pollCreatorJid of creatorIds) {
		for (const voterJid of voterIds) {
			try {
				vote = decryptPollVote(update.vote, { pollCreatorJid, pollMsgId: entry.keyId, pollEncKey: entry.encKey, voterJid }, { decryptPollVotePayload });
				conn.logger?.info?.(`Poll vote decrypted (creator=${pollCreatorJid} voter=${voterJid})`);
				break;
			} catch {}
		}
		if (vote) break;
	}

	try {
		if (!vote) throw new Error('no JID pair decrypted the vote');
		const command = resolveCommand(entry, vote.selectedOptions ?? []);

		const voterKey = voteKey?.participant || voteKey?.remoteJid;
		if (!command || (voterKey && entry.triggered.has(voterKey))) return;
		entry.triggered.add(voterKey);

		if (command) {
			const { serialize } = await import('#whatsapp/message/serialize.js');
			const fake = {
				key: { ...voteKey, fromMe: false },
				message: { conversation: '.' + command },
				pushName: raw.pushName,
				messageTimestamp: Math.floor(Date.now() / 1000),
			};
			const m = await serialize(conn, fake);
			await handle(conn, m, conn.__pollVoteRegistry);
		}

		if (!entry.pollDeleted) {
			entry.pollDeleted = true;
			await conn.sendMessage(entry.chat, { delete: creationKey }).catch(() => {});
		}
	} catch (e) {
		conn.logger?.warn?.(`Poll vote handling failed: ${e?.message ?? e}`);
	}
}

export default function (conn, registry) {
	conn.__pollVoteRegistry = registry;
	conn.ev.on('messages.upsert', async ({ messages, type }) => {
		const raw = messages?.[0];
		if (!raw || !raw.message) return;

		if (type && type !== 'notify') return;

		const end = conn.logger.time('messages.upsert');

		cacheMessage(raw);

		if (raw.message?.pollUpdateMessage) {
			await handlePollVote(conn, raw);
			end.end?.();
			return;
		}

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
