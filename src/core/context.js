import { config } from '#config/environment.js';

import { formatSize, toTime } from '#utils/format.js';

/**
 * Build the dispatch context for one serialized message.
 * @param {import('baileys').WASocket} conn
 * @param {any} m
 * @param {import('./plugin-registry.js').PluginRegistry} [registry]
 * @returns {import('./plugin-registry.js').Context}
 */
export function createContext(conn, m, registry) {
	const quoted = m.isQuoted ? m.quoted : m;
	return {
		conn,
		m,
		message: m,
		registry,
		isOwner: m.fromMe || config.whatsapp.ownerNumbers.includes(m.sender.split('@')[0]),
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
