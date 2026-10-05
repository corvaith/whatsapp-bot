import { readdirSync, statSync } from 'fs';
import { join } from 'path';

import { config } from '#config/environment.js';
import { MTIME_THROTTLE_MS } from '#config/constants.js';

import { PluginRegistry } from './plugin-registry.js';

/** Recursively list plugin files; `_`-prefixed files/folders are shared helpers, not plugins. */
export function scanPluginFiles(dir = join(process.cwd(), 'src/plugins')) {
	const out = [];
	let entries;
	try {
		entries = readdirSync(dir);
	} catch {
		return out;
	}
	for (const name of entries) {
		if (name.startsWith('_')) continue;
		const full = join(dir, name);
		if (statSync(full).isDirectory()) out.push(...scanPluginFiles(full));
		else if (name.endsWith('.js')) out.push(full);
	}
	return out;
}

/** Load plugins into the registry; throws at startup so a broken plugin never boots silently. */
export async function loadPlugins(registry = new PluginRegistry(), pluginsDir) {
	for (const file of scanPluginFiles(pluginsDir)) {
		const mod = await import(`${file}?load=${Date.now()}`);
		registry.register(mod.default, file, statSync(file).mtimeMs);
	}
	return registry;
}

/**
 * Poll plugin mtimes (throttled, dev only) and reconcile the registry.
 * A file whose re-import fails keeps its previous version.
 */
export async function hotReload(registry, pluginsDir) {
	const now = Date.now();
	if (now - hotReload.lastCheck < MTIME_THROTTLE_MS) return false;
	hotReload.lastCheck = now;

	let changed = false;
	const files = scanPluginFiles(pluginsDir);
	for (const file of files) {
		const mtimeMs = statSync(file).mtimeMs;
		const current = registry.byFile.get(file);
		if (current && current.mtimeMs === mtimeMs) continue;
		try {
			const mod = await import(`${file}?hot=${Date.now()}`);
			registry.replace(file, mod.default, mtimeMs);
			changed = true;
		} catch (err) {
			console.error(`Failed to load plugin ${file}: ${err.message}`);
		}
	}
	for (const file of [...registry.byFile.keys()]) {
		if (!files.includes(file)) {
			registry.remove(file);
			changed = true;
		}
	}
	return changed;
}

hotReload.lastCheck = 0;

/** Single dispatch-time entry point: dev hot-reloads, production is static. */
export async function refreshPlugins(registry) {
	if (config.isDev) await hotReload(registry);
}

export { PluginRegistry };
