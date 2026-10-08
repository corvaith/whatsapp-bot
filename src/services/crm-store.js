import { mkdirSync } from 'fs';
import { statSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { Database } from 'bun:sqlite';
import { proto, generateWAMessage, generateWAMessageFromContent, generateMessageIDV2 } from 'baileys';

const DB_PATH = 'data/database/crm.db';

mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.run('PRAGMA journal_mode = WAL;');
db.run('PRAGMA synchronous = NORMAL;');
db.run('PRAGMA busy_timeout = 5000;');

db.run(`
	CREATE TABLE IF NOT EXISTS messages (
		rowid_ INTEGER PRIMARY KEY AUTOINCREMENT,
		id TEXT NOT NULL,
		chat TEXT NOT NULL,
		sender TEXT,
		timestamp INTEGER,
		data BLOB NOT NULL
	);
	CREATE INDEX IF NOT EXISTS idx_crm_messages_chat ON messages(chat);
	CREATE INDEX IF NOT EXISTS idx_crm_messages_sender ON messages(sender);
	CREATE INDEX IF NOT EXISTS idx_crm_messages_timestamp ON messages(timestamp);
	CREATE TABLE IF NOT EXISTS nodes (
		id TEXT NOT NULL,
		chat TEXT NOT NULL,
		data TEXT NOT NULL,
		created_at INTEGER DEFAULT (strftime('%s','now')),
		PRIMARY KEY(id, chat)
	);
	CREATE INDEX IF NOT EXISTS idx_crm_nodes_chat ON nodes(chat);
	CREATE INDEX IF NOT EXISTS idx_crm_nodes_id ON nodes(id);
`);

const stmt = {
	insertMessage: db.query('INSERT INTO messages (id, chat, sender, timestamp, data) VALUES (?, ?, ?, ?, ?)'),
	getMessage: db.query('SELECT data FROM messages WHERE id = ? AND chat = ? ORDER BY rowid_ DESC LIMIT 1'),
	getMessageById: db.query('SELECT data FROM messages WHERE id = ? ORDER BY rowid_ DESC LIMIT 1'),
	hasMessage: db.query('SELECT 1 FROM messages WHERE id = ? AND chat = ? LIMIT 1'),
	hasMessageById: db.query('SELECT 1 FROM messages WHERE id = ? LIMIT 1'),
	deleteMessage: db.query('DELETE FROM messages WHERE id = ? AND chat = ?'),
	deleteMessageById: db.query('DELETE FROM messages WHERE id = ?'),
	getMessages: db.query('SELECT rowid_ AS rowid, id, chat, sender, timestamp, data FROM messages WHERE chat = ? ORDER BY rowid_ DESC LIMIT ?'),
	getAllMessages: db.query('SELECT rowid_ AS rowid, id, chat, sender, timestamp, data FROM messages ORDER BY rowid_ DESC LIMIT ?'),
	countMessages: db.query('SELECT COUNT(*) AS count FROM messages'),
	insertNode: db.query(`INSERT INTO nodes (id, chat, data) VALUES (?, ?, ?) ON CONFLICT(id, chat) DO UPDATE SET data = excluded.data, created_at = strftime('%s','now')`),
	getNode: db.query('SELECT data FROM nodes WHERE id = ? AND chat = ? ORDER BY created_at DESC LIMIT 1'),
	getNodeById: db.query('SELECT data FROM nodes WHERE id = ? ORDER BY created_at DESC LIMIT 1'),
	deleteNode: db.query('DELETE FROM nodes WHERE id = ? AND chat = ?'),
	deleteNodeById: db.query('DELETE FROM nodes WHERE id = ?'),
	cleanupOrphanNodes: db.query('DELETE FROM nodes WHERE NOT EXISTS (SELECT 1 FROM messages WHERE messages.id = nodes.id AND messages.chat = nodes.chat)'),
	statsMessages: db.query('SELECT COUNT(*) AS count, COALESCE(SUM(LENGTH(data)), 0) AS size, COALESCE(AVG(LENGTH(data)), 0) AS avg FROM messages'),
	statsNodes: db.query('SELECT COUNT(*) AS count, COALESCE(SUM(LENGTH(data)), 0) AS size, COALESCE(AVG(LENGTH(data)), 0) AS avg FROM nodes'),
	rowById: db.query('SELECT rowid_ AS rowid, id, chat, sender, timestamp, data FROM messages WHERE rowid_ = ? LIMIT 1'),
};

// Bun:sqlite uses a reserved "rowid" alias; the explicit rowid_ column maps it.
db.run('CREATE TABLE IF NOT EXISTS _crm_meta (k TEXT PRIMARY KEY, v TEXT)');

const serializeNode = (value) =>
	JSON.stringify(value, (_, v) => {
		if (Buffer.isBuffer(v)) return { type: 'Buffer', data: v.toString('base64') };
		if (v instanceof Uint8Array) return { type: 'Buffer', data: Buffer.from(v).toString('base64') };
		return v;
	});

const deserializeNode = (value) =>
	value
		? JSON.parse(value, (_, v) => {
				if (v && v.type === 'Buffer') return Buffer.from(typeof v.data === 'string' ? v.data : Buffer.from(v.data).toString('base64'), 'base64');
				return v;
			})
		: null;

export function saveMessage(message, chat) {
	if (!message || !chat) return false;
	try {
		const id = message?.key?.id;
		if (!id) return false;
		const encoded = proto.WebMessageInfo.encode(message).finish();
		stmt.insertMessage.run(id, chat, message.participant || message.key?.participant || null, Number(message.messageTimestamp || Math.floor(Date.now() / 1000)), Buffer.from(encoded));
		return true;
	} catch {
		return false;
	}
}

export function loadMessage(id, chat) {
	if (!id) return null;
	try {
		const row = chat ? stmt.getMessage.get(id, chat) : stmt.getMessageById.get(id);
		return row?.data ? proto.WebMessageInfo.decode(row.data) : null;
	} catch {
		return null;
	}
}

export function loadMessageById(id) {
	if (!id) return null;
	try {
		const row = stmt.getMessageById.get(id);
		return row?.data ? proto.WebMessageInfo.decode(row.data) : null;
	} catch {
		return null;
	}
}

export function saveNode(id, chat, node) {
	if (!id || !chat || !node) return false;
	try {
		stmt.insertNode.run(String(id), String(chat), serializeNode(node));
		return true;
	} catch {
		return false;
	}
}

export function loadNode(messageId, jid) {
	if (!messageId) return null;
	try {
		let row = jid ? stmt.getNode.get(String(messageId), String(jid)) : null;
		if (!row?.data) row = stmt.getNodeById.get(String(messageId));
		return row?.data ? deserializeNode(row.data) : null;
	} catch {
		return null;
	}
}

export function saveAdditionalNode(id, chat, content, attrs = {}) {
	if (!id || !chat) return false;
	try {
		const existing = stmt.getNode.get(String(id), String(chat));
		if (existing?.data) {
			const node = deserializeNode(existing.data);
			if (node && typeof node === 'object') {
				node.content = content;
				node.attrs = { ...node.attrs, ...attrs };
				stmt.insertNode.run(String(id), String(chat), serializeNode(node));
				return true;
			}
		}
		stmt.insertNode.run(
			String(id),
			String(chat),
			serializeNode({
				tag: 'message',
				attrs: { id: String(id), from: String(chat), t: String(Math.floor(Date.now() / 1000)), type: 'text', ...attrs },
				content,
			}),
		);
		return true;
	} catch {
		return false;
	}
}

export function loadAdditionalNode(id, chat) {
	const node = loadNode(id, chat);
	return node ? (node.content ?? null) : null;
}

export function hasMessage(id, chat) {
	if (!id) return false;
	try {
		return chat ? !!stmt.hasMessage.get(String(id), String(chat)) : !!stmt.hasMessageById.get(String(id));
	} catch {
		return false;
	}
}

export function deleteMessage(id, chat) {
	if (!id) return false;
	try {
		if (chat) {
			stmt.deleteMessage.run(String(id), String(chat));
			stmt.deleteNode.run(String(id), String(chat));
			return true;
		}
		stmt.deleteMessageById.run(String(id));
		stmt.deleteNodeById.run(String(id));
		return true;
	} catch {
		return false;
	}
}

export function getMessages(chat, limit = 100) {
	if (!chat) return [];
	try {
		return stmt.getMessages.all(String(chat), Math.max(1, Number(limit) || 100)).map((row) => ({
			rowid: row.rowid,
			id: row.id,
			chat: row.chat,
			sender: row.sender,
			timestamp: row.timestamp,
			data: safeDecode(row.data),
		}));
	} catch {
		return [];
	}
}

export function getAllMessages(limit = 100) {
	try {
		return stmt.getAllMessages.all(Math.max(1, Number(limit) || 100)).map((row) => ({
			rowid: row.rowid,
			id: row.id,
			chat: row.chat,
			sender: row.sender,
			timestamp: row.timestamp,
			data: safeDecode(row.data),
		}));
	} catch {
		return [];
	}
}

export function countMessages() {
	try {
		return Number(stmt.countMessages.get()?.count || 0);
	} catch {
		return 0;
	}
}

/** Raw message row (blob undecoded) by SQLite rowid — used by the .crm #rowid flow. */
export function getRowById(rowid) {
	return stmt.rowById.get(Number(rowid)) ?? null;
}

function safeDecode(data) {
	try {
		return proto.WebMessageInfo.decode(data);
	} catch {
		return null;
	}
}

const RETENTION_SECONDS = 7 * 24 * 60 * 60;
const CACHE_LIMIT = Number(process.env.CRM_CACHE_LIMIT || 5000);

export function cleanup() {
	try {
		const cutoff = Math.floor(Date.now() / 1000) - RETENTION_SECONDS;
		db.transaction(() => {
			db.query('DELETE FROM messages WHERE timestamp IS NOT NULL AND timestamp < ?').run(cutoff);
			if (CACHE_LIMIT > 0) {
				db.query('DELETE FROM messages WHERE rowid_ NOT IN (SELECT rowid_ FROM messages ORDER BY rowid_ DESC LIMIT ?)').run(CACHE_LIMIT);
			}
			stmt.cleanupOrphanNodes.run();
		})();
	} catch {}
}

const formatBytes = (bytes) => {
	if (!bytes) return '0 B';
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	let v = Number(bytes);
	let i = 0;
	while (v >= 1024 && i < units.length - 1) {
		v /= 1024;
		i++;
	}
	return `${v.toFixed(2)} ${units[i]}`;
};

export function getStats() {
	try {
		const messages = stmt.statsMessages.get();
		const nodes = stmt.statsNodes.get();
		const fileSize = (p) => (existsSync(p) ? statSync(p).size : 0);
		const dbSize = fileSize(DB_PATH);
		const walSize = fileSize(`${DB_PATH}-wal`);
		const shmSize = fileSize(`${DB_PATH}-shm`);
		const count = Number(messages?.count || 0);
		return {
			messages: count,
			limit: CACHE_LIMIT,
			remaining: Math.max(0, CACHE_LIMIT - count),
			payload: {
				messages: { count, sizeHuman: formatBytes(messages?.size || 0), avgSizeHuman: formatBytes(messages?.avg || 0) },
				nodes: { count: Number(nodes?.count || 0), sizeHuman: formatBytes(nodes?.size || 0) },
			},
			files: { db: formatBytes(dbSize), wal: formatBytes(walSize), shm: formatBytes(shmSize), total: formatBytes(dbSize + walSize + shmSize) },
		};
	} catch {
		return null;
	}
}

export function loadFullMessage(id, chat) {
	const node = loadNode(id, chat);
	return { message: loadMessage(id, chat), additionalNode: node?.content ?? null };
}

function persist(message, id, jid, options) {
	queueMicrotask(() => {
		try {
			saveMessage(proto.WebMessageInfo.fromObject(message), jid);
			saveAdditionalNode(id, jid, options.additionalNodes || [], { t: String(Math.floor(Date.now() / 1000)), ...options.additionalAttributes });
		} catch {}
	});
}

const boundConns = new WeakSet();

/** Wire automatic message/node capture onto a Baileys socket; safe to re-call. */
export function bind(conn) {
	if (!conn || boundConns.has(conn)) return conn;
	boundConns.add(conn);

	conn.ev.on('messages.upsert', ({ messages }) => {
		try {
			for (const message of messages || []) {
				const chat = message?.key?.remoteJid;
				if (message?.key?.id && chat) saveMessage(message, chat);
			}
		} catch {}
	});

	conn.ws.on('CB:message', (node) => {
		try {
			const id = node?.attrs?.id;
			const chat = node?.attrs?.from || node?.attrs?.recipient || node?.attrs?.participant;
			if (id && chat) saveNode(id, chat, node);
		} catch {}
	});

	if (typeof conn.sendMessage === 'function' && !conn.sendMessage.__crmPatched) {
		const original = conn.sendMessage.bind(conn);
		const patched = async (jid, content, options = {}) => {
			const messageId = options.messageId || generateMessageIDV2();
			const generated = await generateWAMessage(jid, content, { ...options, messageId, userJid: conn.user?.id, upload: conn.waUploadToServer });
			const sent = await original(jid, content, { ...options, messageId });
			persist(generated.message, messageId, jid, options);
			return sent;
		};
		patched.__crmPatched = true;
		conn.sendMessage = patched;
	}

	if (typeof conn.relayMessage === 'function' && !conn.relayMessage.__crmPatched) {
		const original = conn.relayMessage.bind(conn);
		const patched = async (jid, content, options = {}) => {
			const messageId = options.messageId || generateMessageIDV2();
			const generated = generateWAMessageFromContent(jid, content, { ...options, messageId, userJid: conn.user?.id, upload: conn.waUploadToServer });
			const resultPromise = original(jid, content, { ...options, messageId });
			persist(generated, messageId, jid, options);
			return resultPromise;
		};
		patched.__crmPatched = true;
		conn.relayMessage = patched;
	}

	return conn;
}

let lastCleanup = 0;
setInterval(() => {
	const now = Date.now();
	if (now - lastCleanup < 60 * 60 * 1000) return;
	lastCleanup = now;
	cleanup();
	try {
		db.run('PRAGMA wal_checkpoint(PASSIVE)');
	} catch {}
}, 60 * 1000).unref?.();

export default {
	db,
	bind,
	saveMessage,
	loadMessage,
	loadMessageById,
	saveNode,
	loadNode,
	saveAdditionalNode,
	loadAdditionalNode,
	hasMessage,
	deleteMessage,
	getMessages,
	getAllMessages,
	countMessages,
	cleanup,
	getStats,
	loadFullMessage,
	getRowById,
};
