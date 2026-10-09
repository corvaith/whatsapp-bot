import { createHash } from 'crypto';
import { config } from '#config.js';

import { refreshPlugins } from './plugins.js';
import { createContext } from './context.js';
import { findByStickerHash, expiresAt } from '#services/commands.js';
import * as savedMessage from '#services/savedMessage.js';
import * as analytics from '#services/groupAnalytics.js';

const isExpired = (entry) => expiresAt(entry) < Date.now();
const stickerHash = (buf) => createHash('sha256').update(buf).digest('hex');

/** Execute a resolved plugin with the standard access checks (never bypasses owner-only). */
async function runPlugin(conn, m, registry, plugin, context) {
	const access = plugin.access || 'public';
	if (access === 'owner' && !context.isOwner) return false;
	conn.logger?.info(`Command executed via custom trigger by ${m.sender}`);
	if (plugin.react) await m.react(plugin.react).catch(() => {});
	await plugin.run(context);
	return true;
}

/**
 * Route one serialized message to plugins. Errors propagate untouched so the
 * caller (events/messages.js) keeps producing user-facing error replies.
 * @param {import('baileys').WASocket} conn
 * @param {any} m
 * @param {import('./plugin-registry.js').PluginRegistry} registry
 */
export async function handle(conn, m, registry) {
	if (m.isBot) return;
	analytics.record(m);
	analytics.prune();

	await refreshPlugins(registry);
	const context = createContext(conn, m, registry);
	if (!config.bot.publicMode && !context.isOwner) return;

	if (context.isCommand) {
		const plugin = registry.findCommand(context.command);
		if (plugin) {
			const access = plugin.access || 'public';
			if (access === 'owner' && !context.isOwner) return;
			conn.logger?.info(`Command ${context.prefix}${context.command} executed by ${m.sender}`);
			if (plugin.react) await m.react(plugin.react).catch(() => {});
			await plugin.run(context);
		}
	}

	if (m.type === 'stickerMessage') {
		try {
			const buf = await m.download();
			if (buf?.length) {
				const hash = stickerHash(buf);
				const entry = findByStickerHash(hash);
				if (entry && !isExpired(entry)) {
					const plugin = registry.findCommand(entry.command);
					if (plugin) {
						await runPlugin(conn, m, registry, plugin, context);
						return;
					}
				}
			}
		} catch (e) {
			conn.logger?.warn?.(`Sticker trigger lookup failed: ${e?.message ?? e}`);
		}
	}

	const keyword = String(m.body ?? '')
		.trim()
		.toLowerCase();
	if (keyword && !keyword.startsWith(m.prefix || '.')) {
		const entry = savedMessage.findByKeyword(m.chat, keyword);
		if (entry) {
			await savedMessage.replay(entry, m, conn);
			return;
		}
	}

	for (const { plugin } of registry.getTriggers()) {
		const access = plugin.access || 'public';
		if (access === 'owner' && !context.isOwner) continue;
		if (await plugin.match(context)) await plugin.run(context);
	}
}
