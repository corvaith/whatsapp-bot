import { config } from '#config.js';
import { saveMode } from '#services/botMode.js';

/**
 * Toggle bot access mode at runtime: .mode public | .mode self.
 * Mutates the shared config object so dispatcher's check flips immediately
 * without a process restart.
 */
export default {
	commands: ['mode'],
	category: 'owner',
	access: 'owner',
	description: 'Switch the bot between public and self (owner-only) mode.',
	usage: '{prefix}mode <public|self>',

	async run(context) {
		const { m, args, text } = context;
		const target = String(text || '')
			.trim()
			.toLowerCase();

		if (target === 'status' || !target) {
			const current = config.bot.publicMode ? 'public' : 'self';
			return m.reply(`Current mode: *${current}*\nUsage: ${m.prefix}mode <public|self>`);
		}

		if (target !== 'public' && target !== 'self') {
			return m.reply(`Unknown mode "${target}". Use public or self.`);
		}

		const next = target === 'public';
		if (config.bot.publicMode === next) {
			return m.reply(`Bot is already in *${target}* mode.`);
		}
		config.bot.publicMode = next;
		saveMode(target);
		await m.reply(`✓ Mode switched to *${target}* — ${next ? 'everyone can use the bot.' : 'only the owner can use the bot.'}`);
	},
};
