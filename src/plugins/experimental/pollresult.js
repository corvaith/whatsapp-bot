/**
 * Send a frozen poll-result snapshot card.
 */
export default {
	commands: ['pollresult'],
	category: 'experimental',
	description: 'Send a poll result snapshot. Usage: .pollresult <name> | Option=123 | Option=4',
	usage: '{prefix}pollresult <name> | <option>=<count> [| ...]',
	react: '📊',

	async run(context) {
		const { m, conn, text } = context;
		const parts = (text || '').split('|').map((s) => s.trim()).filter(Boolean);
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
