import { listActive, expiresAt } from '#services/custom-command.js';

export default {
	commands: ['listcmd'],
	category: 'owner',
	access: 'owner',
	description: 'List active custom sticker commands.',
	usage: '{prefix}listcmd',

	async run({ m }) {
		const entries = listActive().filter((c) => expiresAt(c) > Date.now());
		if (!entries.length) return m.reply('No active custom commands.');

		const lines = entries.map((c) => `${c.id} → ${c.command}`);
		await m.reply(`Custom Commands\n\n${lines.join('\n')}\n\n${entries.length} active commands`);
	},
};
