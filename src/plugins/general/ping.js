/**
 * Check the bot response time.
 */
export default {
	commands: ['ping'],
	category: 'general',
	description: 'Check the bot response time.',
	usage: '{prefix}ping',

	async run({ m }) {
		const startedAt = Date.now();
		await m.react('😼');
		await m.reply(`Response time: ${Date.now() - startedAt} ms`);
	},
};
