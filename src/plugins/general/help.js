import { renderUsage } from '#utils/format.js';

/**
 * Show available commands, generated from the plugin registry (Katsumi style).
 */
export default {
	commands: ['help', 'menu'],
	category: 'general',
	description: 'Show available commands.',
	usage: '{prefix}help [command or category]',

	async run({ m, registry, isOwner }) {
		const groups = registry.getVisibleCommands({ isOwner });
		const collator = new Intl.Collator('id', { sensitivity: 'base', numeric: true });
		const categories = [...groups.keys()].sort((a, b) => collator.compare(a, b));

		const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
		const { getPrefixes } = await import('#core/plugins.js');
		const prefix = m.prefix || getPrefixes()[0] || '.';
		let response = '';

		const query = (m.args?.[0] || '').toLowerCase().replace(prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), '');

		if (!query) {
			response += `Hello, @${m.sender.replace(/[^0-9]/g, '')}!\n\n`;
			response += '_𓆩♡𓆪 *Available Commands:*_\n';

			for (const category of categories) {
				response += `\nꕥ ${cap(category)}\n`;
				for (const { name, aliases } of groups.get(category)) {
					const aliasNote = aliases.length ? ` _(alias: ${aliases.join(', ')})_` : '';
					response += `•  *${prefix}${name}*${aliasNote}\n`;
				}
			}

			response += `\nꕥ _Tip: \`${prefix}help [command or category]\` for details._`;
		} else {
			let entry = null;
			for (const category of categories) {
				const hit = groups.get(category).find(({ name, aliases }) => name === query || aliases.includes(query));
				if (hit) {
					entry = hit;
					break;
				}
			}

			if (entry) {
				const { plugin, name, aliases } = entry;
				response += `ꕥ Command: *${name}*\n\n`;
				response += `• *Description:* ${plugin.description}\n`;
				if (aliases.length) response += `• *Aliases:* \`${[name, ...aliases].join(', ')}\`\n`;
				response += `• *Category:* ${cap(plugin.category || 'general')}\n`;
				if (plugin.usage) {
					response += `• *Usage:*\n${String(plugin.usage)
						.split('\n')
						.map((line) => `  \`${renderUsage(line.trim(), prefix)}\``)
						.join('\n')}\n`;
				}
				if ((plugin.access || 'public') === 'owner') response += '• *Owner Only*\n';
				response += '\n✨ _Respect cooldown & enjoy!_';
			} else if (groups.has(query)) {
				response += `ꕥ *${cap(query)} Commands:*\n\n`;
				for (const { plugin, name, aliases } of groups.get(query)) {
					const aliasNote = aliases.length ? ` _(alias: ${aliases.join(', ')})_` : '';
					response += `•  *${prefix}${name}*${aliasNote}: ${plugin.description}\n`;
				}
				response += `\n_Explore more: \`${prefix}help <command>\`_`;
			} else {
				response = `*Not Found*\n│\n🙁 Sorry, *${query}* not found.\n\n_Type:_ \`${prefix}help\` _to see all commands._\n`;
			}
		}

		await m.reply(response.trim());
	},
};
