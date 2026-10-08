import { listForChat } from '#services/saved-message.js';

export default {
	commands: ['listmsg'],
	category: 'group',
	description: 'List saved messages in this chat.',
	usage: '{prefix}listmsg',

	async run({ m }) {
		const entries = listForChat(m.chat);
		if (!entries.length) return m.reply('No saved messages in this chat.');

		const lines = entries.map((s) => `${s.id} → ${s.keyword}`);
		await m.reply(`Saved Messages\n\n${lines.join('\n')}\n\n${entries.length} saved messages`);
	},
};
