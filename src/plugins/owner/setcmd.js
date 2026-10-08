import { stickerHash, findByStickerHash, create } from '#services/custom-command.js';

export default {
	commands: ['setcmd'],
	category: 'owner',
	access: 'owner',
	description: 'Bind a sticker to a registered command as a trigger.',
	usage: '{prefix}setcmd <command> (reply to a sticker)',

	async run({ m, args, registry }) {
		const command = (args[0] || '').toLowerCase();
		if (!m.isQuoted || m.quoted.type !== 'stickerMessage') return m.reply('Please reply to a sticker.');
		if (!command) return m.reply('Usage: .setcmd <command>');

		const plugin = registry.findCommand(command);
		if (!plugin) return m.reply(`Command "${command}" does not exist.`);

		const buf = await m.quoted.download();
		if (!buf?.length) return m.reply('Could not download the sticker.');

		const hash = stickerHash(buf);
		const existing = findByStickerHash(hash);
		if (existing) return m.reply(`This sticker is already assigned to "${existing.command}".`);

		const entry = create({ stickerHash: hash, command, createdBy: m.sender });
		await m.reply(`✓ Sticker command created\nCommand: ${entry.command}\nID: ${entry.id}\nExpires: 7 days`);
	},
};
