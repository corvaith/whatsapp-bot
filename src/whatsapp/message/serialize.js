// Sumber: https://github.com/DikaArdnt/readsw/blob/master/lib/serialize.js (copy punya Dika Ardnt)
import makeWASocket, {
	areJidsSameUser,
	getBinaryNodeChild,
	getBinaryNodeChildren,
	downloadMediaMessage,
	extractMessageContent,
	jidNormalizedUser,
	getDevice,
	isJidGroup,
	isPnUser,
	isLidUser,
	Browsers,
} from 'baileys';

import { parseCommand } from '#core/prefix.js';

import { fileTypeFromBuffer } from 'file-type';
import fs from 'fs';
import path from 'path';

import { createChalkLogger } from '#utils/logger.js';

export default async function (connectionOptions) {
	const conn = makeWASocket({
		logger: createChalkLogger({ level: 'silent' }),
		browser: Browsers.ubuntu('Edge'),
		...connectionOptions,
	});

	const client = Object.defineProperties(conn, {
		getJid: {
			value(sender) {
				sender = jidNormalizedUser(sender);
				conn.isLid ??= new Map();
				if (conn.isLid.has(sender)) return conn.isLid.get(sender);
				if (!sender.endsWith('@lid')) return sender;

				const cached = conn.isLid.get(sender);
				if (cached) return cached;

				for (const chat of Object.values(conn.groups)) {
					const user = chat?.participants?.find((p) => p.lid === sender || p.id === sender);

					if (user) {
						const jid = user.phoneNumber || user.jid || user.id;
						conn.isLid.set(sender, jid);
						return jid;
					}
				}

				return sender;
			},
		},
		parseJid: {
			value(jid) {
				return jidNormalizedUser(jid);
			},
		},
		logger: {
			value: createChalkLogger({ level: 'info' }),
		},
		fetchPrivacyStories: {
			async value() {
				const res = await conn.query({
					tag: 'iq',
					attrs: {
						to: '@s.whatsapp.net',
						xmlns: 'status',
						type: 'get',
					},
					content: [
						{
							tag: 'privacy',
							attrs: {},
						},
					],
				});

				const privacy = getBinaryNodeChild(res, 'privacy');

				if (!privacy) return null;

				const lists = getBinaryNodeChildren(privacy, 'list');

				const parseUsers = (list) => {
					const users = getBinaryNodeChildren(list, 'user');
					return users.map((v) => v.attrs.jid);
				};

				const blacklist = lists.find((v) => v.attrs.type === 'blacklist');
				const whitelist = lists.find((v) => v.attrs.type === 'whitelist');

				return {
					mode: lists.find((v) => v.attrs.default === 'true')?.attrs?.type || 'contacts',
					blacklist: parseUsers(blacklist),
					whitelist: parseUsers(whitelist),
				};
			},
		},

		parseMention: {
			value(text) {
				if (!text) return [];

				const match = [...text?.matchAll(/@([0-9]{5,16}|0)/g)].map((m) => m[1]);
				const out = [];

				for (const id of match) {
					if (id.length < 10) continue;
					const lid = `${id}@lid`;
					const jid = conn.getJid(lid);

					if (conn.isLid.has(lid)) out.push(lid);
					else if (jid && jid !== lid && jid.includes(id)) out.push(jid);
					else out.push(`${id}@s.whatsapp.net`);
				}

				return [...new Set(out)];
			},
			enumerable: true,
		},
		getFile: {
			async value(PATH, saveToFile = false) {
				let filename;
				let data;

				if (Buffer.isBuffer(PATH)) {
					data = PATH;
				} else if (PATH instanceof ArrayBuffer) {
					data = Buffer.from(PATH);
				} else if (/^data:.*?\/.*?;base64,/i.test(PATH)) {
					data = Buffer.from(PATH.split(',')[1], 'base64');
				} else if (/^https?:\/\//.test(PATH)) {
					const response = await fetch(PATH);
					data = Buffer.from(await response.arrayBuffer());
				} else if (fs.existsSync(PATH)) {
					filename = PATH;
					data = fs.readFileSync(PATH);
				} else if (typeof PATH === 'string') {
					data = Buffer.from(PATH);
				} else {
					data = Buffer.alloc(0);
				}

				if (!Buffer.isBuffer(data)) throw new TypeError('Result is not a buffer');

				const type = (await fileTypeFromBuffer(data)) || {
					mime: 'application/octet-stream',
					ext: 'bin',
				};

				if (data && saveToFile && !filename) {
					filename = path.join(process.cwd(), `tmp/${Date.now()}.${type.ext}`);
					await fs.promises.writeFile(filename, data);
				}

				return {
					filename,
					...type,
					data,
					deleteFile() {
						return filename && fs.promises.unlink(filename);
					},
				};
			},
			enumerable: true,
		},

		downloadMediaMessage: {
			async value(message, filename) {
				const media = await downloadMediaMessage(
					message,
					'buffer',
					{},
					{
						logger: createChalkLogger({ level: 'fatal', prefix: 'hisoka' }),
						reuploadRequest: conn.updateMediaMessage,
					},
				);

				if (filename) {
					const mime = await fileTypeFromBuffer(media);
					const filePath = path.join(process.cwd(), `${filename}.${mime.ext}`);
					await fs.promises.writeFile(filePath, media);
					return filePath;
				}

				return media;
			},
			enumerable: true,
		},
	});

	return client;
}

export async function serialize(conn, msg) {
	if (!msg) return;
	const m = {};
	m.message = parseMessage(msg.message);

	if (msg.key) {
		m.key = msg.key;
		m.id = m.key.id;
		m.device = getDevice(m.id);
		m.isBot = m.id.startsWith('3EB0');
		m.chat = m.key.remoteJid;
		m.isGroup = isJidGroup(m.chat);
		m.sender = conn.getJid(m.key.participantAlt || m.key.participant || m.chat);
		m.fromMe = m.key.fromMe || areJidsSameUser(m.sender, conn.parseJid(conn.user?.id));
	}

	m.pushname = msg.pushName;
	m.timesTamp = msg.messageTimestamp;

	if (m.message) {
		m.type = getContentType(m.message);
		m.msg = m.message[m.type];
		m.isMedia = !!m.msg?.mimetype || !!m.msg?.thumbnailDirectPath;
		const mention = [...(m.msg?.contextInfo?.mentionedJid || []), ...(m.msg?.contextInfo?.groupMentions?.map((v) => v.groupJid) || [])];
		m.mentions = mention.map((jid) => conn.getJid(jid));
		m.body =
			m.msg?.text ||
			m.msg?.conversation ||
			m.msg?.caption ||
			m.message?.conversation ||
			m.msg?.selectedButtonId ||
			m.msg?.singleSelectReply?.selectedRowId ||
			m.msg?.selectedId ||
			m.msg?.contentText ||
			m.msg?.selectedDisplayText ||
			m.msg?.title ||
			m.msg?.name ||
			'';
		const parsed = parseCommand(m.body);
		m.prefix = parsed.prefix;
		m.command = parsed.command;
		m.cmd = parsed.cmd;
		m.args = parsed.args;
		m.text = parsed.text;
		m.rawText = parsed.rawText;
		m.expiration = m.msg?.contextInfo?.expiration || 0;

		if (m.isMedia) {
			m.download = () => conn.downloadMediaMessage(m);
		}

		m.isQuoted = false;

		if (m.msg?.contextInfo?.quotedMessage) {
			m.isQuoted = true;
			m.quoted = {};
			m.quoted.message = parseMessage(m.msg?.contextInfo?.quotedMessage);

			if (m.quoted.message) {
				m.quoted.type = getContentType(m.quoted.message) || Object.keys(m.quoted.message)[0];
				m.quoted.msg = m.quoted.message[m.quoted.type];
				m.quoted.isMedia = !!m.quoted.msg?.mimetype || !!m.quoted.msg?.thumbnailDirectPath;

				m.quoted.key = {
					remoteJid: m.msg?.contextInfo?.remoteJid || m.chat,
					participant: conn.parseJid(m.msg?.contextInfo?.participant),
					fromMe: areJidsSameUser(conn.getJid(m.msg?.contextInfo?.participant), conn.parseJid(conn.user?.id)),
					id: m.msg?.contextInfo?.stanzaId,
				};

				m.quoted.id = m.msg?.contextInfo?.stanzaId;
				m.quoted.device = getDevice(m.quoted.id);
				m.quoted.chat = /g\.us|status/.test(m.msg?.contextInfo?.remoteJid) ? m.quoted.key.participant : m.quoted.key.remoteJid;
				m.quoted.fromMe = m.quoted.key.fromMe;
				m.quoted.sender = conn.getJid(m.msg?.contextInfo?.participant || m.quoted.chat);

				const mentionQuoted = [...(m.quoted.msg?.contextInfo?.mentionedJid || []), ...(m.quoted.msg?.contextInfo?.groupMentions?.map((v) => v.groupJid) || [])];
				m.quoted.mentions = mentionQuoted.map((jid) => conn.getJid(jid));
				m.quoted.body =
					m.quoted.msg?.text ||
					m.quoted.msg?.caption ||
					m.quoted?.message?.conversation ||
					m.quoted.msg?.selectedButtonId ||
					m.quoted.msg?.singleSelectReply?.selectedRowId ||
					m.quoted.msg?.selectedId ||
					m.quoted.msg?.contentText ||
					m.quoted.msg?.selectedDisplayText ||
					m.quoted.msg?.title ||
					m.quoted?.msg?.name ||
					'';
				m.quoted.args = m.quoted.body.trim().split(/ +/).slice(1);
				m.quoted.text = m.quoted.args.join(' ');

				if (m.quoted.isMedia) {
					m.quoted.download = () => conn.downloadMediaMessage(m.quoted);
				}
			}
		}
	}

	m.react = (emoji) => {
		return conn.sendMessage(m.chat, {
			react: { text: emoji, key: m.key },
		});
	};

	m.reply = (text, options = {}) => {
		if (typeof text === 'string') {
			return conn.sendMessage(
				m.chat,
				{
					text,
					contextInfo: {
						mentionedJid: [...conn.parseMention(text)],
					},
					...options,
				},
				{ quoted: m, ephemeralExpiration: m.expiration, ...options },
			);
		} else if (typeof text === 'object') {
			return conn.sendMessage(m.chat, { ...text, ...options }, { quoted: m, ephemeralExpiration: m.expiration, ...options });
		}
	};

	return m;
}

function parseMessage(content) {
	content = extractMessageContent(content);

	if (content && content.viewOnceMessageV2Extension) {
		content = content.viewOnceMessageV2Extension.message;
	}
	if (content && content.protocolMessage && content.protocolMessage.type == 14) {
		let type = getContentType(content.protocolMessage);
		content = content.protocolMessage[type];
	}
	if (content && content.message) {
		let type = getContentType(content.message);
		content = content.message[type];
	}

	return content;
}

const getContentType = (content) => {
	if (content) {
		const keys = Object.keys(content);
		const key = keys.find((k) => (k === 'conversation' || k.endsWith('Message') || k.includes('V2') || k.includes('V3')) && k !== 'senderKeyDistributionMessage');
		return key;
	}
};
