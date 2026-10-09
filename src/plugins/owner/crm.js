import crypto from 'crypto';
import { proto } from 'baileys';

import crmStore from '#services/crmStore.js';

const parseMessage = (content) => {
	content = content?.viewOnceMessage?.message ?? content?.ephemeralMessage?.message ?? content?.viewOnceMessageV2?.message ?? content;
	if (content?.protocolMessage?.editedMessage) content = content.protocolMessage.editedMessage?.message ?? content.protocolMessage.editedMessage;
	if (content?.message) content = content.message;
	return content;
};

const IGNORED_TAGS = new Set(['device-identity', 'quality_control', 'enc', 'hsm', 'verified_name', 'multicast', 'reporting', 'unavailable', 'rcat']);
const IGNORED_ATTRS = new Set(['id', 'from', 'to', 'participant', 'recipient', 'type', 'sts', 'verified_level', 'notify', 'addressing_mode', 'verified_name', 'participant_pn', 't', 'count']);
const SECRET_CONTEXT = { EVENT_EDIT: 'Event Edit', MESSAGE_EDIT: 'Message Edit', POLL_EDIT: 'Poll Edit', POLL_ADD_OPTION: 'Poll Edit' };

const HELP = `📌 Owner CRM tools — reply to a message or use a rowid:

• .crm [flags] — relay-ready snippet of the quoted message
• .insp [flags] — raw payload (JSON)
• .adn — AdditionalNodes captured for the message
• .relay [flags] — re-relay the quoted message with its children
• .lastchat [n] — list the last n stored messages
• .crmstat — storage statistics

Flags: -raw -message -relay -file -snip -nofilter -nochild -noproto
Rowid form: .crm #4825 (fetch straight from the store)`;

export default {
	commands: ['crm', 'insp', 'adn', 'relay', 'lastchat', 'crmstat'],
	category: 'owner',
	access: 'owner',
	description: 'Message capture/relay toolkit backed by the crm store.',
	usage: '{prefix}crm | insp | adn | relay | lastchat [n] | crmstat (reply or #rowid)',

	async run(context) {
		const { m, args, text, conn, command } = context;
		const flags = ` ${args.join(' ')} `;
		const arg0 = args[0] || '';

		if (command !== 'lastchat' && command !== 'crmstat' && !m.isQuoted && m.type === 'stickerMessage' && m.msg?.contextInfo?.quotedMessage) {
			m.isQuoted = true;
			m.quoted = {
				chat: m.chat,
				id: m.msg.contextInfo.stanzaId,
				message: parseMessage(m.msg.contextInfo.quotedMessage),
				sender: m.msg.contextInfo.participant,
				timesTamp: m.timesTamp,
			};
			m.quoted.chat = m.chat;
			m.quoted.fakeObj = undefined;
		}

		if (command === 'crmstat') {
			const stats = crmStore.getStats();
			if (!stats) return m.reply('CRM store unavailable.');
			return m.reply(
				[
					'🗄️ CRM Store',
					`Messages: ${stats.messages} / limit ${stats.limit}`,
					`Payload  : ${stats.payload.messages.sizeHuman} (avg ${stats.payload.messages.avgSizeHuman})`,
					`Nodes    : ${stats.payload.nodes.count} (${stats.payload.nodes.sizeHuman})`,
					`Files    : db ${stats.files.db} + wal ${stats.files.wal} + shm ${stats.files.shm} = ${stats.files.total}`,
				].join('\n'),
			);
		}

		if (command === 'lastchat') {
			const limit = Math.min(Math.max(parseInt(arg0, 10) || 10, 1), 50);
			const rows = getLastChatRows(crmStore, m, limit);
			if (!rows.length) return m.reply('No stored messages found.');
			return m.reply(formatLastChat(rows));
		}

		let chatId;
		let targetId;
		let msgSource;
		let rmsg;

		const rowMatch = arg0.match(/^#(\d+)$/);
		if (rowMatch) {
			const rowid = Number(rowMatch[1]);
			const row = crmStore.getRowById(rowid);
			if (!row) return m.reply(`Rowid #${rowid} not found.`);

			try {
				rmsg = toObject(proto.WebMessageInfo.decode(row.data));
			} catch (e) {
				return m.reply(`Failed to decode rowid #${rowid}: ${e.message}`);
			}
			chatId = row.chat;
			targetId = row.id;
			msgSource = `rowid:${rowid}`;
		} else {
			if (!m.isQuoted) return m.reply(HELP);

			chatId = m.quoted.chat || m.chat;
			targetId = m.quoted.id;

			const sources = [
				{ type: 'crmstore', data: crmStore.loadMessage(targetId, chatId) },
				{ type: 'quotedObj', data: m.quoted.fakeObj ?? m.quoted },
			];
			const source = sources.find((v) => v.data?.message || v.data?.key);
			msgSource = source?.type;
			rmsg = source?.data;
		}

		let msg = rmsg ? normalizeMessage(rmsg, crmStore, chatId) : null;
		if (!msg?.message) return m.reply(`Invalid message (${msg?.message})`);

		const messageId = msg.key?.id || targetId;
		const rawNode = loadBestNode(crmStore, messageId, chatId, msg);
		const nodeAttrs = getNodeAttributes(rawNode);
		const nodeContent = getNodeContent(rawNode);
		const type = Object.keys(msg.message).find((v) => !['messageContextInfo', 'senderKeyDistributionMessage'].includes(v)) || 'unknown';

		const additionalNodes = filterAdditionalNodes(nodeContent);
		const relayOptions = getRelayOptions(rawNode);
		const parentSender = getSenderIdentity(msg.key);

		const stats = { fails: 0 };
		const noChild = flags.includes('-nochild');
		const noProto = flags.includes('-noproto');
		const childTree = noChild ? [] : buildChildTree(crmStore, chatId, messageId, parentSender, 50, 0, 5, new Set(), !noProto, stats);

		if (command === 'relay') {
			const newParentId = await conn.relayMessage(m.chat, structuredClone(msg.message), relayOptions);
			await relayChildTree(conn, m.chat, childTree, newParentId);
			return m.reply(String(newParentId));
		}

		const rawPayload = { message: msg, node: rawNode, additionalAttributes: nodeAttrs, additionalNodes };
		const raw = stringify(rawPayload);
		const message = stringify(msg.message);
		const key = stringify(msg.key);
		const options = stringifySnippet(relayOptions);
		const sender = msg.key?.participant || msg.key?.participantAlt || msg.key?.remoteJid || '-';
		const msgId = msg.key?.id || targetId || '-';
		const nodeChat = rawNode?.attrs?.from || rawNode?.attrs?.to || rawNode?.attrs?.recipient || '-';
		const metadata = [
			`• Type     : ${type}`,
			`• Source   : ${msgSource || '-'}`,
			`• Chat     : ${chatId}`,
			`• Node Chat: ${nodeChat}`,
			`• ID       : ${msgId}`,
			`• Node ID  : ${rawNode?.attrs?.id || '-'}`,
			`• Sender   : ${String(sender).split('@')[0]}`,
			`• Node Tag : ${rawNode?.tag || '-'}`,
			`• Attrs    : ${Object.keys(nodeAttrs).length}`,
			`• Children : ${countTree(childTree)}${stats.fails ? ` (${stats.fails} fail)` : ''}`,
		].join('\n');

		const files = { raw, message, relay: buildRelayScript(stringifySnippet(msg.message), stringifySnippet(relayOptions), childTree) };
		const exportType = ['raw', 'message', 'relay'].find((v) => flags.includes(`-${v}`));

		if (exportType) {
			const isCode = exportType === 'relay';
			const body = files[exportType];
			const fileName = isCode ? `${type}.js` : `${exportType}.json`;
			if (flags.includes('-snip') && body.length <= 40000) {
				return m.reply(`\`\`\`${isCode ? 'js' : 'json'}\n${body}\n\`\`\``);
			}
			return m.reply({
				document: Buffer.from(body),
				fileName,
				mimetype: isCode ? 'application/javascript' : 'application/json',
				caption: metadata,
			});
		}

		if (command === 'insp') {
			const payload = attachChildren(rawPayload, childTree);
			return m.reply({
				document: Buffer.from(stringify(payload)),
				fileName: `${type}.json`,
				mimetype: 'application/json',
				caption: metadata,
			});
		}

		const adn = flags.includes('-nofilter') ? additionalNodes : filterAdditionalNodes(additionalNodes);
		if (command === 'adn' && !adn.length) return m.reply('No AdditionalNodes captured.');

		if (command === 'adn') {
			return m.reply({
				document: Buffer.from(stringify(adn)),
				fileName: 'additionalNodes.json',
				mimetype: 'application/json',
			});
		}

		if (command === 'crm') {
			const code = files.relay;
			if (flags.includes('-snip')) {
				if (code.length > 40000) {
					await m.react('❌').catch(() => {});
					return m.reply('Relay snippet too large — use the default document output.');
				}
				return m.reply(`${metadata}\n\n\`\`\`js\n${code}\n\`\`\``);
			}
			return m.reply({ document: Buffer.from(code), fileName: `${type}.js`, mimetype: 'application/javascript', caption: metadata });
		}

		return m.reply(HELP);
	},
};

const toObject = (decoded) => proto.WebMessageInfo.toObject(decoded, { enums: Number, longs: Number, bytes: Buffer, defaults: false });

function normalizeMessage(rmsg, crmstore, chat) {
	return decryptSecretEnvelope(toObject(proto.WebMessageInfo.fromObject(rmsg)), crmstore, chat);
}

function decryptSecretEnvelope(msg, crmstore, chat) {
	const secret = msg?.message?.secretEncryptedMessage;
	if (!secret) return msg;
	const type = secretEncTypeName(secret.secretEncType);
	if (!SECRET_CONTEXT[type]) return msg;
	const targetKey = secret.targetMessageKey;
	if (!targetKey?.id) return msg;

	const target = loadTargetSecret(crmstore, chat, targetKey);
	if (!target) return msg;

	const decrypted = decryptSecretMessage(secret, target, type);
	return decrypted ? { ...msg, message: decrypted } : msg;
}

function loadBestNode(crmstore, messageId, chatId, msg) {
	if (!messageId) return null;
	try {
		const direct = crmstore.loadNode(messageId, chatId);
		if (direct) return direct;
	} catch {}
	const alt = [msg?.key?.remoteJid, msg?.key?.remoteJidAlt, msg?.key?.participant, msg?.key?.participantAlt].filter(Boolean);
	for (const jid of [...new Set(alt)]) {
		try {
			const node = crmstore.loadNode(messageId, jid);
			if (node) return node;
		} catch {}
	}
	try {
		return crmstore.loadNode(messageId) || null;
	} catch {
		return null;
	}
}

function getNodeAttributes(node) {
	if (!node?.attrs || typeof node.attrs !== 'object') return {};
	const attrs = { ...node.attrs };
	for (const k of IGNORED_ATTRS) delete attrs[k];
	return attrs;
}

const getNodeContent = (node) => (node && Array.isArray(node.content) ? node.content : []);
const filterAdditionalNodes = (nodes) => (nodes || []).filter((v) => !IGNORED_TAGS.has(v?.tag));

function getRelayOptions(node = null) {
	const additionalNodes = filterAdditionalNodes(getNodeContent(node));
	const options = {};
	if (additionalNodes.length) options.additionalNodes = additionalNodes;
	return options;
}

function getSenderIdentity(key) {
	if (!key) return { me: false, jids: new Set() };
	if (key.fromMe) return { me: true, jids: new Set() };
	const jids = new Set([key.participant, key.participantAlt].filter(Boolean));
	if (!jids.size && key.remoteJid) jids.add(key.remoteJid);
	return { me: false, jids };
}

const serializeSender = (sender) => (sender ? (sender.me ? 'me' : [...sender.jids].sort().join(',')) : '');

function collectDeepKeys(node, depth = 0, maxDepth = 12, out = []) {
	if (!node || typeof node !== 'object' || depth > maxDepth) return out;
	if (node.protocolMessage?.key) out.push(node.protocolMessage.key);
	if (node.secretEncryptedMessage?.targetMessageKey) out.push(node.secretEncryptedMessage.targetMessageKey);
	for (const value of Object.values(node)) if (value && typeof value === 'object') collectDeepKeys(value, depth + 1, maxDepth, out);
	return out;
}

function collectSecretMessages(node, depth = 0, maxDepth = 12, out = []) {
	if (!node || typeof node !== 'object' || depth > maxDepth) return out;
	if (node.secretEncryptedMessage) out.push(node.secretEncryptedMessage);
	for (const value of Object.values(node)) if (value && typeof value === 'object') collectSecretMessages(value, depth + 1, maxDepth, out);
	return out;
}

function findMessageSecret(node, depth = 0, maxDepth = 12) {
	if (!node || typeof node !== 'object' || depth > maxDepth) return null;
	if (node.messageContextInfo?.messageSecret) return node.messageContextInfo.messageSecret;
	for (const value of Object.values(node)) {
		if (value && typeof value === 'object') {
			const found = findMessageSecret(value, depth + 1, maxDepth);
			if (found) return found;
		}
	}
	return null;
}

function loadTargetSecret(crmstore, chat, targetKey) {
	try {
		const row = crmstore.loadMessage(targetKey.id, chat);
		if (!row) return null;
		const normalized = toObject(row);
		const secretB64 = findMessageSecret(normalized.message);
		if (!secretB64) return null;
		const senderJid = normalized.key?.participant || targetKey.participant || normalized.key?.remoteJid || targetKey.remoteJid;
		if (!senderJid) return null;
		return { messageSecret: Buffer.from(secretB64, 'base64'), senderJid };
	} catch {
		return null;
	}
}

function secretEncTypeName(value) {
	if (typeof value === 'string') return value;
	try {
		return proto.Message.SecretEncryptedMessage.SecretEncType[value] ?? value;
	} catch {
		return value;
	}
}

function decryptSecretMessage(secretMsg, target, type) {
	try {
		const targetId = secretMsg?.targetMessageKey?.id;
		if (!targetId || !secretMsg?.encPayload || !secretMsg?.encIv || !target?.messageSecret) return null;
		const context = SECRET_CONTEXT[type];
		if (!context) return null;
		const messageSecret = target.messageSecret;
		if (messageSecret.length !== 32) return null;

		const senderJid = target.senderJid;
		const info = Buffer.concat([Buffer.from(targetId, 'utf8'), Buffer.from(senderJid, 'utf8'), Buffer.from(senderJid, 'utf8'), Buffer.from(context, 'utf8')]);
		const key = crypto.hkdfSync('sha256', messageSecret, Buffer.alloc(0), info, 32);
		const encPayload = Buffer.from(secretMsg.encPayload, 'base64');
		const encIv = Buffer.from(secretMsg.encIv, 'base64');
		if (encIv.length !== 12 || encPayload.length < 16) return null;

		const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(key), encIv);
		decipher.setAuthTag(encPayload.subarray(-16));
		const plaintext = Buffer.concat([decipher.update(encPayload.subarray(0, -16)), decipher.final()]);
		return proto.Message.toObject(proto.Message.decode(plaintext), { enums: Number, longs: Number, bytes: String, defaults: false });
	} catch {
		return null;
	}
}

function decryptChildMessage(crmstore, chat, msgObj) {
	const secrets = collectSecretMessages(msgObj);
	if (!secrets.length) return { message: msgObj, fails: 0 };

	let current = msgObj;
	let fails = 0;
	for (const secretMsg of secrets) {
		const targetKey = secretMsg?.targetMessageKey;
		const target = targetKey?.id ? loadTargetSecret(crmstore, chat, targetKey) : null;
		const decrypted = target ? decryptSecretMessage(secretMsg, target, secretEncTypeName(secretMsg.secretEncType)) : null;
		if (!decrypted) {
			fails++;
			continue;
		}
		current = replaceSecretEnvelope(current, secretMsg, decrypted);
	}
	return { message: current, fails };
}

function sameSecretEnvelope(a, b) {
	return a?.targetMessageKey?.id === b?.targetMessageKey?.id && a?.encPayload === b?.encPayload && a?.encIv === b?.encIv && a?.secretEncType === b?.secretEncType;
}

function replaceSecretEnvelope(node, targetSecret, decrypted) {
	if (!node || typeof node !== 'object') return node;
	if (node.secretEncryptedMessage === targetSecret || (node.secretEncryptedMessage && sameSecretEnvelope(node.secretEncryptedMessage, targetSecret))) return decrypted;
	if (Array.isArray(node)) return node.map((v) => replaceSecretEnvelope(v, targetSecret, decrypted));
	const out = { ...node };
	for (const [k, v] of Object.entries(out)) if (v && typeof v === 'object') out[k] = replaceSecretEnvelope(v, targetSecret, decrypted);
	return out;
}

function matchesParentKey(keyObj, parentKey, chat) {
	if (!keyObj || !parentKey) return false;
	if (!keyObj.id || keyObj.id !== parentKey.id) return false;
	const keyRemoteJid = keyObj.remoteJid || keyObj.remoteJidAlt;
	const parentRemoteJid = parentKey.remoteJid || chat;
	return !keyRemoteJid || !parentRemoteJid || keyRemoteJid === parentRemoteJid;
}

function findDirectChildren(crmstore, chat, parentId, radius = 50, useProto = true) {
	const base = crmStoreQuery('SELECT timestamp, data FROM messages WHERE id = ? AND chat = ? LIMIT 1').get(parentId, chat);
	if (!base) return [];

	let parentMessage;
	try {
		parentMessage = toObject(proto.WebMessageInfo.decode(base.data));
	} catch {
		return [];
	}
	const parentKey = { id: parentMessage.key?.id, remoteJid: parentMessage.key?.remoteJid || chat, fromMe: !!parentMessage.key?.fromMe };
	if (!parentKey.id) return [];

	const older = crmStoreQuery('SELECT id, data FROM messages WHERE chat = ? AND timestamp <= ? ORDER BY timestamp DESC LIMIT ?').all(chat, base.timestamp, radius);
	const newer = crmStoreQuery('SELECT id, data FROM messages WHERE chat = ? AND timestamp > ? ORDER BY timestamp ASC LIMIT ?').all(chat, base.timestamp, radius);

	const children = [];
	for (const row of [...older, ...newer]) {
		if (row.id === parentId) continue;
		let decoded;
		try {
			decoded = toObject(proto.WebMessageInfo.decode(row.data));
		} catch {
			continue;
		}
		const assocKey = decoded?.message?.messageContextInfo?.messageAssociation?.parentMessageKey;
		const matchedDeep = useProto ? collectDeepKeys(decoded?.message).some((k) => matchesParentKey(k, parentKey, chat)) : false;
		if (!matchesParentKey(assocKey, parentKey, chat) && !matchedDeep) continue;
		children.push(decoded);
	}
	return children;
}

function buildChildTree(crmstore, chat, parentId, parentSender, radius = 50, depth = 0, maxDepth = 5, visited = new Set(), useProto = true, stats = { fails: 0 }) {
	if (depth >= maxDepth) return [];
	const visitKey = `${chat}:${parentId}:${serializeSender(parentSender)}`;
	if (visited.has(visitKey)) return [];
	visited.add(visitKey);

	const result = [];
	for (const rawChild of findDirectChildren(crmstore, chat, parentId, radius, useProto)) {
		const normalized = normalizeMessage(rawChild, crmstore, chat);
		const decrypted = decryptChildMessage(crmstore, chat, normalized.message);
		stats.fails += decrypted.fails;
		const finalRaw = { ...normalized, message: decrypted.message };
		const msg = unwrapAssociatedChild(finalRaw);
		if (!msg?.key?.id || !msg?.message) continue;

		const childId = msg.key.id;
		const childNode = loadBestNode(crmstore, childId, chat, msg);
		result.push({
			raw: finalRaw,
			node: childNode,
			msg,
			relayOptions: getRelayOptions(childNode),
			children: buildChildTree(crmstore, chat, childId, getSenderIdentity(msg.key), radius, depth + 1, maxDepth, visited, useProto, stats),
		});
	}
	return result;
}

async function relayChildTree(conn, chat, nodes, parentId) {
	for (const node of nodes) {
		const message = structuredClone(node.msg.message);
		const assoc = message?.messageContextInfo?.messageAssociation;
		if (assoc?.parentMessageKey) {
			assoc.parentMessageKey.id = parentId;
			assoc.parentMessageKey.remoteJid = chat;
			assoc.parentMessageKey.fromMe = true;
		}
		for (const key of collectProtocolKeys(message)) {
			key.id = parentId;
			key.remoteJid = chat;
			key.fromMe = true;
		}
		const newChildId = await conn.relayMessage(chat, message, { ...node.relayOptions });
		await relayChildTree(conn, chat, node.children, newChildId);
	}
}

function collectProtocolKeys(node, depth = 0, maxDepth = 12, out = []) {
	if (!node || typeof node !== 'object' || depth > maxDepth) return out;
	if (node.protocolMessage?.key) out.push(node.protocolMessage.key);
	for (const value of Object.values(node)) if (value && typeof value === 'object') collectProtocolKeys(value, depth + 1, maxDepth, out);
	return out;
}

function unwrapAssociatedChild(msg) {
	const inner = msg?.message?.associatedChildMessage?.message;
	if (!inner) return msg;
	return { ...msg, message: { ...inner, messageContextInfo: msg?.message?.messageContextInfo } };
}

function countTree(nodes) {
	return nodes.reduce((sum, node) => sum + 1 + countTree(node.children), 0);
}

function attachChildren(base, tree) {
	if (!tree.length) return base;
	return { ...base, __children: tree.map((node) => attachChildren(node.node ? { ...node.raw, __node: node.node } : node.raw, node.children)) };
}

function crmStoreQuery(sql) {
	return crmStore.db.query(sql);
}

function getLastChatRows(crmstore, m, limit) {
	const chat = m.quoted?.chat || m.chat;
	const ts = Number(m.quoted?.timesTamp || m.timesTamp || 0) || Math.floor(Date.now() / 1000);
	return crmStoreQuery('SELECT rowid_ AS rowid, id, chat, sender, timestamp, data FROM messages WHERE chat = ? AND timestamp <= ? ORDER BY timestamp DESC, rowid_ DESC LIMIT ?')
		.all(chat, ts, limit)
		.reverse();
}

function getMessageType(message) {
	if (!message) return '-';
	return Object.keys(message).find((v) => !['messageContextInfo', 'senderKeyDistributionMessage'].includes(v)) || '-';
}

function getPreviewText(message) {
	if (!message) return '-';
	if (typeof message.conversation === 'string') return message.conversation;
	if (message.extendedTextMessage?.text) return message.extendedTextMessage.text;
	if (message.imageMessage) return message.imageMessage.caption ? `📷 ${message.imageMessage.caption}` : '📷 Image';
	if (message.videoMessage) return message.videoMessage.caption ? `🎥 ${message.videoMessage.caption}` : '🎥 Video';
	if (message.audioMessage) return '🎵 Audio';
	if (message.stickerMessage) return '🎨 Sticker';
	if (message.documentMessage) return message.documentMessage.fileName || '📄 Document';
	if (message.reactionMessage) return `💬 Reaction ${message.reactionMessage.text || ''}`.trim();
	if (message.protocolMessage) return '⚙️ Protocol';
	if (message.secretEncryptedMessage) return '🔐 SecretEncryptedMessage';
	return getMessageType(message);
}

function formatTimestamp(ts) {
	if (!ts) return '--:--:--';
	const date = new Date(Number(ts) * 1000);
	if (Number.isNaN(date.getTime())) return '--:--:--';
	return new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Asia/Jakarta' }).format(date);
}

function formatLastChat(rows) {
	const lines = [`╭─〔 LAST CHAT • ${rows.length} MESSAGES 〕`, '│'];
	for (let i = 0; i < rows.length; i++) {
		const row = rows[i];
		let message = null;
		try {
			message = toObject(proto.WebMessageInfo.decode(row.data));
		} catch {}
		const sender = message?.key?.fromMe ? 'Me' : message?.key?.participantAlt || message?.key?.participant || row.sender || 'Unknown';
		lines.push(`│ ${String(i + 1).padStart(2, '0')}  ${formatTimestamp(row.timestamp)}  ${String(sender).split('@')[0]}`);
		lines.push(`│     ${getMessageType(message?.message)} • #${row.rowid}`);
		lines.push(`│     ${String(getPreviewText(message?.message)).replace(/\n/g, ' ').slice(0, 180)}`);
		if (i !== rows.length - 1) lines.push('│');
	}
	lines.push('│', `╰─ ${rows[0]?.chat || '-'}`);
	return lines.join('\n');
}

function stringify(obj) {
	return JSON.stringify(
		obj,
		(key, value) => {
			if (Buffer.isBuffer(value)) return value.toString('base64');
			if (value?.type === 'Buffer' && Array.isArray(value.data)) return Buffer.from(value.data).toString('base64');
			return value;
		},
		2,
	);
}

const indentBlock = (str, level = 1) => {
	const pad = '  '.repeat(level);
	return str
		.split('\n')
		.map((line, i) => (i === 0 ? line : pad + line))
		.join('\n');
};

function stringifySnippet(obj) {
	const raws = [];
	const json = JSON.stringify(
		obj,
		(key, value) => {
			if (key === 'unifiedResponse' && value && typeof value === 'object' && typeof value.data === 'string') {
				try {
					const parsed = JSON.parse(Buffer.from(value.data, 'base64').toString('utf8'));
					raws.push(`Buffer.from(JSON.stringify(${JSON.stringify(parsed, null, 2)})).toString('base64')`);
					return { data: `__RAW_${raws.length - 1}__` };
				} catch {}
			}
			if (key === 'buttonParamsJson' && typeof value === 'string') {
				try {
					raws.push(`JSON.stringify(${JSON.stringify(JSON.parse(value), null, 2)})`);
					return `__RAW_${raws.length - 1}__`;
				} catch {}
			}
			if (Buffer.isBuffer(value)) return value.toString('base64');
			if (value?.type === 'Buffer' && Array.isArray(value.data)) return Buffer.from(value.data).toString('base64');
			return value;
		},
		2,
	);

	let code = json.replace(/^(\s*)"([^"]+)":/gm, (_, indent, k) => `${indent}${k}:`);
	code = code
		.split('\n')
		.map((line) => {
			const match = line.match(/^(\s*).*"__RAW_(\d+)__"/);
			if (!match) return line;
			const [, indent, id] = match;
			const block = raws[Number(id)]
				.split('\n')
				.map((l, i) => (i === 0 ? l : indent + l))
				.join('\n');
			return line.replace(`"__RAW_${id}__"`, block);
		})
		.join('\n');
	return code;
}

function findBlockEnd(str, openIndex) {
	let depth = 0;
	for (let i = openIndex; i < str.length; i++) {
		if (str[i] === '{') depth++;
		if (str[i] === '}' && --depth === 0) return i;
	}
	return -1;
}

function injectKeyBlock(snippet, marker, parentIdExpr) {
	const start = snippet.indexOf(marker);
	if (start === -1) return snippet;
	const end = findBlockEnd(snippet, start + marker.length - 1);
	if (end === -1) return snippet;
	const indent = snippet.slice(0, start).match(/([ \t]*)$/)?.[1] ?? '';
	const replacement = `${marker.slice(0, -1)}{\n${indent}  remoteJid: m.chat,\n${indent}  fromMe: true,\n${indent}  id: ${parentIdExpr}\n${indent}}`;
	return snippet.slice(0, start) + replacement + snippet.slice(end + 1);
}

const injectParentKey = (s, expr) => injectKeyBlock(s, 'parentMessageKey: {', expr);
const injectTargetKey = (s, expr) => injectKeyBlock(s, 'targetMessageKey: {', expr);

function injectProtocolKey(snippet, parentIdExpr) {
	const marker = 'protocolMessage: {';
	const start = snippet.indexOf(marker);
	if (start === -1) return snippet;
	const blockEnd = findBlockEnd(snippet, start + marker.length - 1);
	if (blockEnd === -1) return snippet;
	return snippet.slice(0, start) + injectKeyBlock(snippet.slice(start, blockEnd + 1), 'key: {', parentIdExpr) + snippet.slice(blockEnd + 1);
}

function buildChildScript(nodes, parentVar, path = []) {
	const blocks = [];
	nodes.forEach((node, i) => {
		const varName = `id_${[...path, i].join('_')}`;
		let childSnippet = injectParentKey(stringifySnippet(node.msg.message), parentVar);
		childSnippet = injectProtocolKey(childSnippet, parentVar);
		childSnippet = injectTargetKey(childSnippet, parentVar);
		blocks.push(`const ${varName} = await conn.relayMessage(\n  m.chat,\n${indentBlock(childSnippet)},\n${indentBlock(stringifySnippet(node.relayOptions))}\n);`);
		if (node.children.length) blocks.push(...buildChildScript(node.children, varName, [...path, i]));
	});
	return blocks;
}

function buildRelayScript(snippetMessage, options, childTree) {
	if (!childTree.length) {
		return `=> conn.relayMessage(\n  m.chat,\n${indentBlock(snippetMessage)},\n${indentBlock(options)}\n)`;
	}
	const parentBlock = `const newParentId = await conn.relayMessage(\n  m.chat,\n${indentBlock(snippetMessage)},\n${indentBlock(options)}\n);`;
	return '> ' + [parentBlock, ...buildChildScript(childTree, 'newParentId'), 'return newParentId;'].join('\n\n');
}
