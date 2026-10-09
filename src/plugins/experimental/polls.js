/**
 * Poll commands: create, command-trigger polls and result snapshots.
 * Vote decryption/registry lives in services/polls.js; delivery in events wiring.
 */
import { randomBytes } from 'crypto';
import { proto } from 'baileys';
import { registerPoll } from '#services/polls.js';

/** Create a poll (single or multi select). */
export const poll = {
	commands: ['poll'],
	category: 'experimental',
	description: 'Create a poll in this chat.',
	usage: '{prefix}poll <question> | <option> | <option> [| ...]',

	async run(context) {
		const { m, text } = context;
		const parts = (text || '')
			.split('|')
			.map((s) => s.trim())
			.filter(Boolean);
		if (parts.length < 3) {
			return m.reply(`Usage: ${m.prefix}poll Question | Option 1 | Option 2 [| more options]`);
		}
		const [name, ...values] = parts;
		if (values.length > 12) return m.reply('Maximum 12 options.');
		const selectableCount = /selectone\b|single/i.test(name) ? 1 : values.length;
		await m.reply({ poll: { name, values, selectableCount } });
	},
};

/** Command-trigger poll: vote an option and the matching command runs. */
export const pollcmd = {
	commands: ['pollcmd'],
	category: 'experimental',
	access: 'owner',
	description: 'Send a poll whose options trigger commands on vote.',
	usage: '{prefix}pollcmd',

	async run(context) {
		const { m, conn } = context;
		const options = ['ping', 'info', 'prefix'];
		const messageSecret = randomBytes(32);

		const sent = await conn.sendMessage(m.chat, { poll: { name: 'Run a command', values: options, selectableCount: 1, messageSecret } }, { quoted: m });

		const keyId = sent?.key?.id;
		if (!keyId) return m.reply('Failed to read the poll message id.');

		registerPoll({ keyId, chat: m.chat, encKey: messageSecret, options });
		await m.reply('Poll registered — vote an option to trigger its command. The poll is deleted after the first vote.');
	},
};

/** Send a frozen poll-result snapshot card. */
export const pollresult = {
	commands: ['pollresult'],
	category: 'experimental',
	description: 'Send a poll result snapshot',
	usage: '{prefix}pollresult <name> | <option>=<count> | <option>=<count>',
	react: '📊',

	async run(context) {
		const { m, conn, text } = context;
		const parts = (text || '')
			.split('|')
			.map((s) => s.trim())
			.filter(Boolean);
		if (parts.length < 2) return m.reply(`Usage: ${m.prefix}pollresult <name> | <option>=<count> [| ...]`);
		const [name, ...opts] = parts;
		const pollVotes = [];
		for (const opt of opts) {
			const idx = opt.lastIndexOf('=');
			if (idx < 1) return m.reply(`Invalid option "${opt}" — use Option=Count`);
			pollVotes.push({ optionName: opt.slice(0, idx).trim(), optionVoteCount: String(parseInt(opt.slice(idx + 1), 10) || 0) });
		}
		await conn.relayMessage(m.chat, { pollResultSnapshotMessage: { name, pollType: 1, pollVotes } }, {});
	},
};

export default [poll, pollcmd, pollresult];
