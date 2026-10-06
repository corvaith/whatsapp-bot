/**
 * Create a WhatsApp event card (starts 5 minutes from now).
 */
export default {
	commands: ['event'],
	category: 'experimental',
	description: 'Create an event starting in 5 minutes. Usage: .event <name> | [description]',
	usage: '{prefix}event <name> | [description]',
	react: '📅',

	async run(context) {
		const { m, text } = context;
		const parts = (text || '').split('|').map((s) => s.trim());
		const name = parts[0];
		if (!name) return m.reply(`Usage: ${m.prefix}event <name> | [description]`);
		const now = new Date();
		await m.reply({
			event: {
				name,
				description: parts[1] || undefined,
				startDate: new Date(now.getTime() + 5 * 60 * 1000),
				endDate: new Date(now.getTime() + 2 * 60 * 60 * 1000),
				isCancelled: false,
				extraGuestsAllowed: true,
			},
		});
	},
};
