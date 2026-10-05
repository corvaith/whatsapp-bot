import { renderUsage } from '#utils/format.js';
/**
 * Interactive native list version of the help menu.
 */
export default {
	commands: ['menul'],
	category: 'experimental',
	description: 'Show the command menu as a native WhatsApp list.',
	usage: '{prefix}menul',

	async run(context) {
		const { m, conn, registry, isOwner, prefix } = context;
		const groups = registry.getVisibleCommands({ isOwner });
		const sections = [...groups.keys()]
			.sort((a, b) => a.localeCompare(b))
			.map((category) => ({
				title: category[0].toUpperCase() + category.slice(1),
				rows: groups.get(category).map(({ name, plugin }) => ({
					title: renderUsage(`{prefix}${name}`, prefix),
					description: plugin.description || '',
					id: `${prefix}${name}`,
				})),
			}));

		if (!sections.length) return m.reply('No commands available.');

		const listMessage = {
			title: 'Bot Commands',
			text: 'Select a command:',
			buttonText: 'Open menu',
			sections,
			footer: 'whatsapp-bot',
		};

		// baileys listMessage via relay + biz node (native_flow single_select)
		await conn.relayMessage(
			m.chat,
			{
				viewOnceMessage: {
					message: {
						messageContextInfo: {
							deviceListMetadata: {},
							deviceListMetadataVersion: 2,
						},
						listMessage,
					},
				},
			},
			{
				additionalNodes: [
					{
						tag: 'biz',
						attrs: {},
						content: [{ tag: 'list', attrs: { v: '2', type: 'product_list' } }],
					},
				],
			},
		);
	},
};
