/**
 * Create a poll (single or multi select).
 */
export default {
	commands: ['poll'],
	category: 'experimental',
	description: 'Create a poll. Usage: .poll Question | Option 1 | Option 2',
	usage: '{prefix}poll <question> | <option> | <option> [| ...]',

	async run(context) {
		const { m, text } = context;
		const parts = (text || '').split('|').map((s) => s.trim()).filter(Boolean);
		if (parts.length < 3) {
			return m.reply(`Usage: ${m.prefix}poll Question | Option 1 | Option 2 [| more options]`);
		}
		const [name, ...values] = parts;
		if (values.length > 12) return m.reply('Maximum 12 options.');
		// unique question (someone typed it first) -> single select, else multi select
		const selectableCount = /selectone\b|single/i.test(name) ? 1 : values.length;
		await m.reply({ poll: { name, values, selectableCount } });
	},
};
