import { createHash } from 'crypto';

const TTL_MS = 60 * 60 * 1000;
const polls = new Map();

const optionHash = (name) => createHash('sha256').update(name, 'utf8').digest('hex');

export function registerPoll({ keyId, chat, encKey, options }) {
	polls.set(keyId, { keyId, chat, encKey: Buffer.from(encKey), options, createdAt: Date.now(), triggered: new Set(), pollDeleted: false });
	prune();
}

export function getPoll(keyId) {
	const entry = polls.get(keyId);
	if (!entry || Date.now() - entry.createdAt > TTL_MS) return null;
	return entry;
}

/** Drop a poll from the registry after its TTL passes. */
export function removePoll(keyId) {
	polls.delete(keyId);
}

/** Map decrypted vote hashes back to the option/command name. */
export function resolveCommand(entry, selectedHashes) {
	const map = new Map(entry.options.map((name) => [optionHash(name), name]));
	for (const raw of selectedHashes) {
		const hex = Buffer.from(raw).toString('hex');
		if (map.has(hex)) return map.get(hex);
	}
	return null;
}

function prune() {
	const now = Date.now();
	for (const [keyId, entry] of polls) {
		if (now - entry.createdAt > TTL_MS) polls.delete(keyId);
	}
}
