import { config } from '#config/environment.js';

import { refreshPlugins } from './plugin-loader.js';
import { createContext } from './context.js';

/**
 * Route one serialized message to plugins. Errors propagate untouched so the
 * caller (events/messages.js) keeps producing user-facing error replies.
 * @param {import('baileys').WASocket} conn
 * @param {any} m
 * @param {import('./plugin-registry.js').PluginRegistry} registry
 */
export async function handle(conn, m, registry) {
	if (m.isBot) return;
	await refreshPlugins(registry);
	const context = createContext(conn, m, registry);
	if (!config.bot.publicMode && !context.isOwner) return;

	if (context.isCommand) {
		const plugin = registry.findCommand(context.command);
		if (plugin) {
			const access = plugin.access || 'public';
			if (access === 'owner' && !context.isOwner) return;
			conn.logger?.info(`Command ${context.prefix}${context.command} executed by ${m.sender}`);
			await plugin.run(context);
		}
	}

	for (const { plugin } of registry.getTriggers()) {
		const access = plugin.access || 'public';
		if (access === 'owner' && !context.isOwner) continue;
		if (await plugin.match(context)) await plugin.run(context);
	}
}
