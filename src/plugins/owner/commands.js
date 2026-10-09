/**
 * Custom sticker-command management: bind, list and delete sticker triggers.
 */
import { stickerHash, findByStickerHash, create, get, remove, listActive, expiresAt } from '#services/commands.js';

export const setcmd = {
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

export const delcmd = {
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

export const listcmd = {
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

export default [setcmd, delcmd, listcmd];
