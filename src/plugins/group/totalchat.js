import { getStats } from '#services/group-analytics.js';

const fmt = (n) => (n ?? 0).toLocaleString('en-US');

export default {
	commands: ['totalchat'],
	category: 'group',
	description: 'Show group chat statistics (today/week/month).',
	usage: '{prefix}totalchat [today|week|month]',

	async run({ m, args }) {
		if (!m.isGroup) return m.reply('This command can only be used in a group.');

		const range = ['today', 'week', 'month'].includes(args[0]) ? args[0] : 'week';
		const stats = getStats(m.chat, range);

		const title = { today: 'Today', week: 'Last 7 Days', month: 'Last 30 Days' }[range];
		const lines = [
			'📊 Group Chat Statistics',
			'',
			`Period: ${title}`,
			'',
			`Messages: ${fmt(stats.messages)}`,
			`Active members: ${fmt(stats.members)}`,
			'',
			`Text:     ${fmt(stats.totals.text)}`,
			`Images:   ${fmt(stats.totals.image)}`,
			`Videos:   ${fmt(stats.totals.video)}`,
			`Audio:    ${fmt(stats.totals.audio)}`,
			`Stickers: ${fmt(stats.totals.sticker)}`,
			`Other:    ${fmt(stats.totals.other)}`,
		];

		const top = stats.rows.slice(0, 10);
		if (top.length) {
			lines.push('', '🔥 Most Active');
			top.forEach((r, i) => lines.push(`${i + 1}. @${String(r.userId).split('@')[0]} — ${fmt(r.total)} messages`));
		}

		await m.reply(lines.join('\n'), { contextInfo: { mentionedJid: top.map((r) => r.userId) } });
	},
};
