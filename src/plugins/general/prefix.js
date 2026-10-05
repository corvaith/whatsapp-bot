/** Show the currently active command prefixes. */
export default {
	commands: ['prefix'],
	category: 'general',
	description: 'Show active command prefixes.',
	usage: '{prefix}prefix',

	async run({ m, prefix }) {
		const { getPrefixes } = await import('#core/prefix.js');
		await m.reply(
			`Active prefixes: ${getPrefixes()
				.map((p) => `\`${p}\``)
				.join(' ')}\nYou used: \`${prefix}\``,
		);
	},
};
