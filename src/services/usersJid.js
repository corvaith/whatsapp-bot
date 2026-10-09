/**
 * Canonical user identity helpers. Meta is migrating every user JID to LID
 * (linked device ID), so features key user data on the LID and only translate
 * to phone numbers when a legacy API requires one.
 */
import { jidNormalizedUser } from 'baileys';

/** Bidirectional PN <-> LID registry, populated from live group metadata. */
const pnToLid = new Map();
const lidToPn = new Map();

export const isLid = (jid) => typeof jid === 'string' && jid.endsWith('@lid');
export const isPn = (jid) => typeof jid === 'string' && jid.endsWith('@s.whatsapp.net');

/** Remember that a phone number and a LID are the same person. */
export function linkJids(a, b) {
	if (!a || !b) return;
	let A;
	let B;
	try {
		A = jidNormalizedUser(a);
		B = jidNormalizedUser(b);
	} catch {
		return;
	}
	if (A === B) return;
	const lid = isLid(A) ? A : isLid(B) ? B : undefined;
	const pn = isPn(A) ? A : isPn(B) ? B : undefined;
	if (!lid || !pn) return;
	pnToLid.set(pn, lid);
	lidToPn.set(lid, pn);
}

/** Harvest PN/LID pairs from group metadata participants. */
export function linkFromMetadata(meta) {
	for (const p of meta?.participants ?? []) {
		const lid = isLid(p?.id) ? p.id : isLid(p?.lid) ? p.lid : undefined;
		const pn = isPn(p?.id) ? p.id : isPn(p?.phoneNumber) ? p.phoneNumber : undefined;
		linkJids(lid, pn);
	}
}

/** Canonical LID for a user JID (returns the input unchanged when unknown). */
export function toLid(jid) {
	if (!jid) return undefined;
	let j;
	try {
		j = jidNormalizedUser(jid);
	} catch {
		return jid;
	}
	if (isLid(j)) return j;
	return pnToLid.get(j) ?? j;
}

/** Phone-number JID for a user LID (returns the input unchanged when unknown). */
export function toPn(jid) {
	if (!jid) return undefined;
	let j;
	try {
		j = jidNormalizedUser(jid);
	} catch {
		return jid;
	}
	if (isPn(j)) return j;
	return lidToPn.get(j) ?? j;
}

/** Forget everything (tests only — keeps runs independent). */
export function clearMappings() {
	pnToLid.clear();
	lidToPn.clear();
}
