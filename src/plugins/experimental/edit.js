/**
 * Edit a message the bot previously sent (reply to it).
 */
export default {
	commands: ['edit'],
	category: 'experimental',
	description: 'Edit a bot message. Reply to it with: .edit <new text>',
	usage: '{prefix}edit <new text> (reply to a bot message)',
	react: '✏️',

	async run(context) {
		const { m, conn, text } = context;
		if (!text) return m.reply(`Usage: reply to a bot message with ${m.prefix}edit <new text>`);
		if (!m.isQuoted || !m.quoted.fromMe) return m.reply('Reply to a message sent by the bot.');
		await conn.sendMessage(m.chat, { text, edit: m.quoted.key });
	},
};
