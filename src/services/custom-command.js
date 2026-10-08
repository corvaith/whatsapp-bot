import { createHash } from 'crypto';
import { CUSTOM_COMMAND_TTL_MS } from './ttl.js';
import { customCommands } from '#storage/store.js';

export const stickerHash = (buf) => createHash('sha256').update(buf).digest('hex');

export const expiresAt = (entry) => (entry?.created_at ?? 0) + CUSTOM_COMMAND_TTL_MS;

const genId = () => {
	for (;;) {
		const id = 'SC-' + createHash('sha256').update(String(Math.random())).digest('hex').slice(0, 4).toUpperCase();
		if (!customCommands.get(id)) return id;
	}
};

export function findByStickerHash(hash) {
	return customCommands.list().find((c) => c.stickerHash === hash);
}

export function get(id) {
	return customCommands.get(id);
}

export function listActive() {
	return customCommands.list();
}

export function create({ stickerHash: hash, command, createdBy }) {
	const entry = {
		id: genId(),
		stickerHash: hash,
		command: command.toLowerCase(),
		createdBy,
	};
	customCommands.upsert(entry);
	return entry;
}

export function remove(id) {
	customCommands.remove(id);
}
