import * as savedMessage from '#services/saved-message.js';

export default {
	commands: ['delmsg'],
	category: 'group',
	description: 'Delete a saved message (and its media) by ID.',
	usage: '{prefix}delmsg <ID>',

	async run({ m, args, context }) {
		const id = (args[0] || '').toUpperCase();
		if (!id) return m.reply('Usage: .delmsg <ID>');

		const entry = savedMessage.get(id);
		if (!entry) return m.reply(`Saved message "${id}" not found.`);
		if (entry.ownerId !== m.sender && !context.isOwner) return m.reply('You can only delete your own saved messages.');

		const deleted = await savedMessage.remove(id);
		if (!deleted) return m.reply(`Saved message "${id}" not found.`);
		await m.reply(`✓ Saved message ${id} deleted.`);
	},
};
