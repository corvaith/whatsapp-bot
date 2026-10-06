/**
 * Check the bot response time.
 */
export default {
	commands: ['ping'],
	category: 'general',
	description: 'Check the bot response time.',
	usage: '{prefix}ping',
	react: '😼',

	async run({ m }) {
		const startedAt = Date.now();
		await m.reply(`Response time: ${Date.now() - startedAt} ms`);
	},
};
