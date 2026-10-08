import * as savedMessage from '#services/saved-message.js';

export default {
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
