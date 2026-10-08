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

	// The voter/creator JIDs feed the HKDF that derives the vote key, and only
	// the exact pair the sender's client used decrypts (a wrong pair fails GCM
	// tag verification). Try the plausible spellings rather than trusting one.
	const creatorIds = [conn.user?.id, jidNormalizedUser(conn.user?.id ?? ''), conn.user?.lid, jidNormalizedUser(conn.user?.lid ?? '')].filter(Boolean);
	const voterIds = [voteKey?.participant, voteKey?.remoteJid, ...creatorIds].filter(Boolean);

	let vote;
	for (const pollCreatorJid of creatorIds) {
		for (const voterJid of voterIds) {
			try {
				vote = decryptPollVote(update.vote, { pollCreatorJid, pollMsgId: entry.keyId, pollEncKey: entry.encKey, voterJid }, { decryptPollVotePayload });
				conn.logger?.info?.(`Poll vote decrypted (creator=${pollCreatorJid} voter=${voterJid})`);
				break;
			} catch {
				// try next pair
			}
		}
		if (vote) break;
	}

	try {
		if (!vote) throw new Error('no JID pair decrypted the vote');
		const command = resolveCommand(entry, vote.selectedOptions ?? []);

		// The poll stays registered: every voter triggers their own vote. Each
		// voter only fires once so re-selecting doesn't re-run the command.
		const voterKey = voteKey?.participant || voteKey?.remoteJid;
		if (!command || (voterKey && entry.triggered.has(voterKey))) return;
		entry.triggered.add(voterKey);

		if (command) {
			// Trigger the command by injecting a synthetic command message.
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

		// Remove the poll message after the first successful trigger so it
		// doesn't accumulate; later votes still route through the registry.
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

		// type 'notify' = pesan live; 'append'/'history' = backfill sync, di-skip.
		if (type && type !== 'notify') return;

		const end = conn.logger.time('messages.upsert');

		cacheMessage(raw);

		// Poll votes arrive as regular upserts; handle registered pollcmd votes
		// before the normal command path (they carry no visible text command).
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
