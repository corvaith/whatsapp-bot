import { decryptPollVote } from 'baileys/lib/Utils/process-message.js';
import { DisconnectReason, jidNormalizedUser } from 'baileys';
import { format } from 'util';

import { handle } from '#core/dispatcher.js';
import { getPoll, resolveCommand } from '#services/polls.js';

import printMessage from '#whatsapp/helpers.js';
import { serialize } from '#whatsapp/messages.js';
import { unwrapSecretEncryptedMessage } from '#whatsapp/messages.js';
import { invalidateGroupMeta } from '#services/groupAdmin.js';
import { contacts } from '#services/storage.js';

/**
 * WhatsApp event registration: contacts, connection lifecycle, groups, messages.
 */
export function handleContacts(conn) {
	conn.pendingContactSaves = 0;
	conn.ev.on('contacts.upsert', (update) => upsertContacts(conn, update));
}

function upsertContacts(conn, update) {
	conn.pendingContactSaves++;
	try {
		const rows = [];
		for (const contact of update) {
			rows.push({
				id: contact.id,
				lid: contact.lid,
				phoneNumber: contact.phoneNumber,
				name: contact.name,
				notify: contact.notify,
				verifiedName: contact.verifiedName,
			});
		}

		contacts.upsertMany(rows);
	} catch (err) {
		conn.logger.error('Failed to save contacts:', err);
	} finally {
		conn.pendingContactSaves--;
	}
}

export function handleConnection(conn, restart = () => startBot()) {
	conn.ev.on('connection.update', async (update) => {
		const { connection, lastDisconnect } = update;

		if (connection === 'close') {
			const error = lastDisconnect?.error;
			const statusCode = error?.output?.statusCode;
			const outMsg = error?.output?.payload?.message || error?.message;

			if ([DisconnectReason.loggedOut, DisconnectReason.multideviceMismatch, 405].includes(statusCode)) {
				conn.logger.fatal(outMsg);
				process.exit(1);
			}

			if (statusCode === DisconnectReason.forbidden) {
				const expire = error?.data?.expire;
				const waitMs = typeof expire === 'number' && expire > Date.now() / 1000 ? expire * 1000 - Date.now() + 5000 : 5000;
				conn.logger.warn(`Temporary ban (${outMsg}); retrying in ${Math.round(waitMs / 1000)}s`);
				await waitUntil(Date.now() + waitMs);
				return restart();
			}

			if (conn?.pendingContactSaves > 0) {
				conn.logger.info('Waiting for contacts to be saved...');
				const deadline = Date.now() + 5000;
				while (conn.pendingContactSaves > 0 && Date.now() < deadline) {
					await new Promise((resolve) => setTimeout(resolve, 50));
				}
			}

			conn.logger.info('Reconnecting...');
			await restart();
		} else if (connection === 'open') {
			conn.logger.info('Bot connected to WhatsApp');
			const sync = conn.logger.time('sync grup');
			conn.groups = await conn.groupFetchAllParticipating();
			sync.end('info');
		}
	});
}

function waitUntil(deadlineMs) {
	return new Promise(async (resolve) => {
		for (let left = deadlineMs - Date.now(); left > 0; left = deadlineMs - Date.now()) {
			await new Promise((r) => setTimeout(r, Math.min(left, 2_147_483_647)));
		}
		resolve();
	});
}

export function handleGroups(conn) {
	conn.ev.on('groups.update', (updates) => {
		for (const update of updates) {
			const id = update.id;
			if (conn.groups[id]) {
				conn.groups[id] = {
					...(conn.groups[id] || {}),
					...(update || {}),
				};
			}
		}
	});

	conn.ev.on('group-participants.update', ({ id, participants, action }) => {
		const metadata = conn.groups[id];
		invalidateGroupMeta(id);
		if (!metadata) return;

		switch (action) {
			case 'add':
			case 'revoked_membership_requests':
				for (const p of participants) metadata.participants.push(p);
				break;
			case 'demote':
			case 'promote':
				for (const p of participants) {
					const target = metadata.participants.find((x) => x.id === p.id);
					if (target) {
						target.admin = action === 'promote' ? 'admin' : null;
					}
				}
				break;
			case 'remove':
				conn.groups[id] = {
					...metadata,
					participants: metadata.participants.filter((p) => !participants.includes(p.id)),
				};
				break;
		}
	});
}

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
			const { serialize } = await import('#whatsapp/messages.js');
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

export function handleMessages(conn, registry) {
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
			conn.logger.error('Failed to process message:', e);
			try {
				m ??= await serialize(conn, raw);
				await m?.reply('Error Kampang : ' + text);
			} catch {}
		}
	});
}

/** Register every event handler on a fresh socket. */
export function registerEvents(conn, registry, restart) {
	handleContacts(conn);
	handleConnection(conn, restart);
	handleGroups(conn);
	handleMessages(conn, registry);
}
