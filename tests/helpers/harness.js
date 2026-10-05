process.env.OWNER_NUMBER ??= '6285719563093';
process.env.PAIRING_NUMBER ??= '6285719563093';

import '../../src/config/environment.js';
import { parseCommand } from '../../src/core/prefix.js';

export function makeConn(overrides = {}) {
	const calls = [];
	return {
		calls,
		user: { id: '6285719563093:1@s.whatsapp.net' },
		async downloadMediaMessage() {
			return Buffer.from('fake-media-bytes');
		},
		...overrides,
	};
}

export function makeM(conn, fields = {}) {
	const calls = conn.calls;
	const body = fields.body ?? '';
	const parsed = parseCommand(body);
	const { prefix, command, args } = parsed;

	const m = {
		isBot: false,
		fromMe: true,
		isGroup: false,
		sender: '6285719563093@s.whatsapp.net',
		chat: '6289999999999@s.whatsapp.net',
		pushname: 'Joo',
		isQuoted: false,
		isMedia: false,
		type: 'conversation',
		body,
		prefix,
		command,
		args,
		text: parsed.text,
		rawText: parsed.rawText,
		async react(emoji) {
			calls.push({ kind: 'react', emoji });
		},
		async reply(payload) {
			calls.push({ kind: 'reply', payload });
		},
	};
	m.cmd = m.prefix + m.command;
	return Object.assign(m, fields);
}

export const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms));

export function normalize(calls) {
	return calls.map((c) => {
		if (c.kind === 'react') return { kind: 'react', emoji: c.emoji };
		const p = c.payload;
		if (typeof p === 'string') return { kind: 'reply', type: 'text', text: p.replace(/\d+/g, '<n>') };
		if (Buffer.isBuffer(p?.image)) return { kind: 'reply', type: 'media', media: 'image', size: p.image.length };
		return { kind: 'reply', type: 'other', payload: typeof p };
	});
}
