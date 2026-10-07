import { settings } from '#storage/settings.js';
import { validatePrefix, setRuntimePrefixes } from '#core/prefix.js';

const GLOBAL_KEY = 'prefix.global';

/**
 * Owner: replace the global prefix set (persisted in store.db).
 */
export default {
	commands: ['setprefix', 'resetprefix'],
	category: 'owner',
	access: 'owner',
	description: 'Set or reset command prefixes.',
	usage: '{prefix}setprefix <p1> [p2...]\n{prefix}resetprefix',

	async run({ m, args, command }) {
		if (command === 'resetprefix') {
			settings.delete(GLOBAL_KEY);
			setRuntimePrefixes(null);
			return m.reply('Prefix reset to environment/default configuration.');
		}

		const values = args.filter((a) => a !== '--chat');
		if (!values.length) return m.reply('Usage: `setprefix <p1> [p2...]` (1-10 prefixes).');

		const seen = new Set();
		const prefixes = [];
		for (const value of values) {
			const check = validatePrefix(value);
			if (!check.ok) return m.reply(check.error);
			if (seen.has(value)) continue;
			seen.add(value);
			prefixes.push(value);
		}
		if (prefixes.length > 10) return m.reply('Maximum 10 prefixes.');

		settings.set(GLOBAL_KEY, JSON.stringify(prefixes));
		setRuntimePrefixes(prefixes);
		await m.reply(`Prefixes updated: ${prefixes.map((p) => `\`${p}\``).join(' ')}`);
	},
};
