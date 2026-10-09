/**
 * Group admin validation helpers shared by group-moderation plugins.
 * All response wording lives in RESPONSES so it can be customized in one place.
 */
import { areJidsSameUser, jidNormalizedUser } from 'baileys';

import { linkFromMetadata, toLid } from '#services/usersJid.js';

const findParticipant = (meta, jid) => {
	const candidates = [jid, jidNormalizedUser(jid)];
	return meta?.participants?.find((p) => {
		const forms = [p.id, p.lid, p.phoneNumber, p.jid];
		return candidates.some((c) =>
			forms.some((f) => {
				if (!f) return false;
				try {
					return f === c || areJidsSameUser(f, c);
				} catch {
					return f === c;
				}
			}),
		);
	});
};

/** Group metadata cache keyed by chat JID (avoids an IQ round trip per check). */
const metaCache = new Map();
const META_TTL = 5_000;

export async function getGroupMeta(conn, jid) {
	const hit = metaCache.get(jid);
	if (hit && Date.now() - hit.t < META_TTL) return hit.meta;
	const meta = await conn.groupMetadata(jid);
	linkFromMetadata(meta);
	metaCache.set(jid, { meta, t: Date.now() });
	return meta;
}

/** Drop cached metadata (called after participant changes so admin status stays fresh). */
export function invalidateGroupMeta(jid) {
	if (jid) metaCache.delete(jid);
	else metaCache.clear();
}

/** The bot's own member entry (matches by phone number and LID forms). */
export function findBotParticipant(meta, conn) {
	const me = conn.user?.id;
	return findParticipant(meta, me) || findParticipant(meta, conn.user?.lid);
}

/** Is the message sender a group admin (or the owner, who outranks admins)? */
export async function isSenderAdmin(conn, m) {
	if (!m.isGroup) return false;
	const meta = await getGroupMeta(conn, m.chat);
	return findParticipant(meta, m.sender)?.admin != null;
}

/** Is the bot itself an admin in this group? */
export async function isBotAdmin(conn, m) {
	if (!m.isGroup) return false;
	const meta = await getGroupMeta(conn, m.chat);
	return findBotParticipant(meta, conn)?.admin != null;
}

/**
 * Resolve the action target: @mention first, then the replied-to sender,
 * then a raw phone-number argument. Returns a JID or undefined.
 */
export function resolveTarget(m, args) {
	const mentioned = m.msg?.contextInfo?.mentionedJid?.[0] || m.mentions?.[0];
	if (mentioned) return toLid(m.mentions?.[0] || mentioned);
	if (m.isQuoted) return toLid(m.quoted?.lid || m.quoted?.sender);
	const num = (args || []).find((a) => /^\+?\d{8,16}$/.test(a));
	return num ? `${num.replace(/^\+/, '')}@s.whatsapp.net` : undefined;
}

/**
 * Pre-flight target validation against fresh group metadata (cache is dropped
 * first so a just-changed role/leave is not read stale). Returns a rejection
 * reason: 'notInGroup' | 'alreadyAdmin' | 'notAdminTarget' | undefined.
 * Kick skips the role checks; promote/demote get both.
 */
export async function validateTarget(conn, m, target, action) {
	invalidateGroupMeta(m.chat);
	const meta = await getGroupMeta(conn, m.chat);
	const entry = findParticipant(meta, target);
	if (!entry) return 'notInGroup';
	if (action === 'promote' && entry.admin != null) return 'alreadyAdmin';
	if (action === 'demote' && entry.admin == null) return 'targetNotAdmin';
	return undefined;
}
