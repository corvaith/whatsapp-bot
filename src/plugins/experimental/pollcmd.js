import { randomBytes } from 'crypto';
import { proto } from 'baileys';

import { registerPoll } from '#services/poll-vote.js';

/**
 * Command-trigger poll: vote an option and the matching command runs.
 * Single-select (V3) so the vote feels like a button press.
 */
export default {
	commands: ['pollcmd'],
	category: 'experimental',
	access: 'owner',
	description: 'Send a poll whose options trigger commands on vote.',
	usage: '{prefix}pollcmd — sends a poll with ping/info/prefix options',

	async run(context) {
		const { m, conn } = context;
		const options = ['ping', 'info', 'prefix'];
		const messageSecret = randomBytes(32);

		const sent = await conn.sendMessage(m.chat, { poll: { name: 'Run a command', values: options, selectableCount: 1, messageSecret } }, { quoted: m });

		// The poll's messageSecret is the vote-encryption key; capture it keyed by
		// the outgoing message id so pollUpdates can be decrypted later.
		const keyId = sent?.key?.id;
		if (!keyId) return m.reply('Failed to read the poll message id.');

		registerPoll({ keyId, chat: m.chat, encKey: messageSecret, options });
		await m.reply('Poll registered — vote an option to trigger its command. The poll is deleted after the first vote.');
	},
};
