/**
 * Forward a message (reply to it) with the forwarded label.
 */
export default {
	commands: ['forward', 'fwd'],
	category: 'experimental',
	description: 'Forward the quoted message (adds the forwarded label). Usage: .forward [target jid or number]',
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
