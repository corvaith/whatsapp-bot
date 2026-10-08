import { get, remove, expiresAt } from '#services/custom-command.js';

export default {
	commands: ['delcmd'],
	category: 'owner',
	access: 'owner',
	description: 'Delete a custom sticker command by ID.',
	usage: '{prefix}delcmd <ID>',

	async run({ m, args }) {
		const id = (args[0] || '').toUpperCase();
		if (!id) return m.reply('Usage: .delcmd <ID>');

		const entry = get(id);
		if (!entry) return m.reply(`Custom command "${id}" not found.`);
		if (expiresAt(entry) < Date.now()) {
			remove(id);
			return m.reply(`Custom command "${id}" has already expired.`);
		}

		remove(id);
		await m.reply(`✓ Custom command ${id} deleted.`);
	},
};
