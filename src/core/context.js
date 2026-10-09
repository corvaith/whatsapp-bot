import { config, isOwnerJid, registerOwnerLid } from '#config.js';

import { formatSize, toTime } from '#utils/format.js';
import { toPn } from '#services/usersJid.js';

/**
 * Build the dispatch context for one serialized message.
 * @param {import('baileys').WASocket} conn
 * @param {any} m
 * @param {import('./plugin-registry.js').PluginRegistry} [registry]
 * @returns {import('./plugin-registry.js').Context}
 */
export function createContext(conn, m, registry) {
	const quoted = m.isQuoted ? m.quoted : m;
	const senderForms = [m.sender, m.lid, toPn(m.sender), toPn(m.lid)].filter(Boolean);
	const isOwner = Boolean(m.fromMe || senderForms.some((jid) => isOwnerJid(jid)));
	if (isOwner && m.lid) registerOwnerLid(m.lid);
	return {
		conn,
		m,
		message: m,
		registry,
		isOwner,
		isCommand: Boolean(m.prefix && m.body.startsWith(m.prefix)),
		quoted,
		downloadM: () => conn.downloadMediaMessage(quoted),
		downloadMedia: () => conn.downloadMediaMessage(quoted),
		args: m.args,
		text: m.text,
		command: m.command,
		prefix: m.prefix,
		rawText: m.rawText,
		formatSize,
		toTime,
	};
}
