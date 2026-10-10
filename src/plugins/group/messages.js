/**
 * Saved-message management: save under a keyword, list, delete by ID.
 */
import * as savedMessage from '#services/savedMessage.js';
import { toLid } from '#services/usersJid.js';

export const savemsg = {
	commands: ['savemsg'],
	category: 'group',
	description: 'Save the quoted message under a keyword for chat-scoped replay.',
	usage: '{prefix}savemsg <keyword> (reply to a message)',

	async run({ m, args }) {
		const keyword = (args[0] || '').trim().toLowerCase();
		if (!keyword) return m.reply('Usage: .savemsg <keyword>');
		if (!m.isQuoted || !m.quoted.message) return m.reply('Please reply to a message to save it.');
		if (keyword.length > 32) return m.reply('Keyword too long (max 32 characters).');

		if (savedMessage.findByKeyword(m.chat, keyword)) {
			return m.reply(`Keyword "${keyword}" already exists.\n\nUse:\n.delmsg <ID>`);
		}

		const entry = await savedMessage.save({ chatId: m.chat, ownerId: m.sender, m });
		if (!entry) {
			return m.reply('This message type cannot be saved.\n\nSupported: text, image, video, audio/voice, sticker, document, location, contact.');
		}
		savedMessage.setKeyword(entry.id, keyword);
		await m.reply(`✓ Saved message ${entry.id} → ${keyword}`);
	},
};

export const delmsg = {
	commands: ['delmsg'],
	category: 'group',
	description: 'Delete a saved message (and its media) by ID.',
	usage: '{prefix}delmsg <ID>',

	async run({ m, args, isOwner }) {
		const id = (args[0] || '').toUpperCase();
		if (!id) return m.reply('Usage: .delmsg <ID>');

		const entry = savedMessage.get(id);
		if (!entry) return m.reply(`Saved message "${id}" not found.`);
		if (entry.ownerId !== toLid(m.sender) && !isOwner) return m.reply('You can only delete your own saved messages.');

		const deleted = await savedMessage.remove(id);
		if (!deleted) return m.reply(`Saved message "${id}" not found.`);
		await m.reply(`✓ Saved message ${id} deleted.`);
	},
};

export const listmsg = {
	commands: ['listmsg'],
	category: 'group',
	description: 'List saved messages in this chat.',
	usage: '{prefix}listmsg',

	async run({ m }) {
		const entries = savedMessage.listForChat(m.chat);
		if (!entries.length) return m.reply('No saved messages in this chat.');

		const lines = entries.map((s) => `${s.id} → ${s.keyword}`);
		await m.reply(`Saved Messages\n\n${lines.join('\n')}\n\n${entries.length} saved messages`);
	},
};

export default [savemsg, delmsg, listmsg];
