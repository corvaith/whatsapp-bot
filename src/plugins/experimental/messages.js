import { proto } from 'baileys';

/**
 * Edit a message the bot previously sent (reply to it).
 */
export const edit = {
	commands: ['edit'],
	category: 'experimental',
	description: 'Edit a bot message. Reply to it with commands',
	usage: '{prefix}edit <new text> (reply to a bot message)',
	react: '✏️',

	async run(context) {
		const { m, conn, text } = context;
		if (!text) return m.reply(`Usage: reply to a bot message with ${m.prefix}edit <new text>`);
		if (!m.isQuoted || !m.quoted.fromMe) return m.reply('Reply to a message sent by the bot.');
		await conn.sendMessage(m.chat, { text, edit: m.quoted.key });
	},
};

/**
 * Forward a message (reply to it) with the forwarded label.
 */
export const forward = {
	commands: ['forward', 'fwd'],
	category: 'experimental',
	description: 'Forward the quoted message (adds the forwarded label)',
	usage: '{prefix}forward [number|jid] (reply to a message; default: this chat)',

	async run(context) {
		const { m, conn, text } = context;
		if (!m.isQuoted || !m.quoted.message) return m.reply(`Reply to a message with ${m.prefix}forward [number|jid]`);
		let target = m.chat;
		if (text && text.trim()) {
			const digits = text.replace(/[^\d@.-]/g, '');
			target = digits.includes('@') ? digits : `${digits}@s.whatsapp.net`;
		}
		const raw = { message: m.quoted.message, key: m.quoted.key };
		await conn.sendMessage(target, { forward: raw, force: true });
	},
};

/**
 * Pin / unpin a message in the chat (reply to it).
 */

export const pin = {
	commands: ['pin'],
	category: 'experimental',
	description: 'Pin a message groups',
	usage: '{prefix}pin [1h|7d|30d|off] (reply to a message)',

	async run(context) {
		const { m, conn, text } = context;
		if (!m.isQuoted) return m.reply(`Usage: reply to a message with ${m.prefix}pin [1h|7d|30d|off]`);
		const arg = (text || '').trim().toLowerCase();
		const durations = { '': 604800, '1h': 86400, '7d': 604800, '30d': 2592000 };
		const off = arg === 'off' || arg === 'unpin';
		if (!off && !(arg in durations)) {
			return m.reply(`Usage: ${m.prefix}pin [1h|7d|30d|off]`);
		}
		await conn.sendMessage(m.chat, {
			pin: m.quoted.key,
			type: off ? proto.PinInChat.Type.UNPIN_FOR_ALL : proto.PinInChat.Type.PIN_FOR_ALL,
			time: off ? 0 : durations[arg],
		});
	},
};

/**
 * Send a self-destructing message (view-once style custom ephemeral).
 */
export const vanish = {
	commands: ['vanish'],
	category: 'experimental',
	description: 'Send a message that disappears after N seconds.',
	usage: '{prefix}vanish <seconds> <text>',

	async run(context) {
		const { m, conn, text } = context;
		const [secondsRaw, ...rest] = (text || '').split(' ');
		const seconds = Math.min(Math.max(parseInt(secondsRaw, 10) || 5, 1), 60);
		const message = rest.join(' ');
		if (!message) return m.reply(`Usage: ${m.prefix}vanish <seconds> <text>`);

		await conn.relayMessage(
			m.chat,
			{
				extendedTextMessage: {
					text: message,
					previewType: 0,
					contextInfo: {
						expiration: 0,
						ephemeralSettingTimestamp: Date.now(),
						disappearingMode: { initiator: 0, trigger: 1 },
						afterReadDuration: seconds,
					},
					inviteLinkGroupTypeV2: 0,
				},
			},
			{},
		);
	},
};

/**
 * Send a contact card (vCard) from a phone number.
 */
export const vcard = {
	commands: ['vcard', 'contact'],
	category: 'experimental',
	description: 'Send a contact card with costum name',
	usage: '{prefix}vcard <number> [name]',

	async run(context) {
		const { m, text } = context;
		const [number, ...nameParts] = (text || '').trim().split(/\s+/);
		if (!number || !/^\+?\d{8,15}$/.test(number.replace(/[\s-]/g, ''))) {
			return m.reply(`Usage: ${m.prefix}vcard <number> [name]`);
		}
		const clean = number.replace(/[^\d]/g, '');
		const name = nameParts.join(' ') || clean;
		const vcard = 'BEGIN:VCARD\n' + 'VERSION:3.0\n' + `FN:${name}\n` + `TEL;type=CELL;type=VOICE;waid=${clean}:+${clean}\n` + 'END:VCARD';
		await m.reply({ contacts: { displayName: name, contacts: [{ vcard }] } });
	},
};

export default [edit, forward, pin, vanish, vcard];
