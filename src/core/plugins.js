/**
 * Plugin infrastructure: registry, discovery/hot reload and command prefix parsing.
 * @typedef {Object} Plugin
 * @property {string[]} [commands]
 * @property {(context: Context) => boolean|Promise<boolean>} [match]
 * @property {(context: Context) => any} run
 * @property {'public'|'owner'} [access]
 * @property {string} [category]
 * @property {string} [description]
 */
import { config } from '#config.js';
import { MTIME_THROTTLE_MS } from '#config.js';
import { relative } from 'path';
import { readdirSync, statSync } from 'fs';
import { join } from 'path';

export const DEFAULT_PREFIXES = ['°', '•', 'π', '÷', '×', '¶', '∆', '£', '¢', '€', '¥', '®', '™', '+', '✓', '=', '|', '/', '~', '!', '?', '@', '#', '%', '^', '&', '.', '©'];

const RESERVED = ['>', '=>', '$'];

const normalize = (value) => String(value ?? '').trim();

/** Validate a single prefix value. Returns { ok, error? }. */
export function validatePrefix(value) {
	const v = normalize(value);
	if (!v) return { ok: false, error: 'Prefix is empty.' };
	if (v.length > 4) return { ok: false, error: `"${v}" is too long (maximum 4 characters).` };
	if (/\s/.test(v)) return { ok: false, error: `"${v}" contains whitespace.` };
	if (/[A-Za-z0-9]/.test(v)) return { ok: false, error: `"${v}" must not contain letters or numbers.` };
	if (RESERVED.includes(v)) return { ok: false, error: `"${v}" is reserved for owner triggers (eval/exec).` };
	return { ok: true };
}

let runtimePrefixes = null;

/** Called by settings loader at startup (and by setprefix/resetprefix). */
export function setRuntimePrefixes(value) {
	if (value === null || value === undefined) {
		runtimePrefixes = null;
		return;
	}
	const list = Array.isArray(value) ? value : JSON.parse(value);
	runtimePrefixes = Array.isArray(list) && list.length ? list.map(normalize).filter(Boolean) : null;
}

function envPrefixes() {
	const raw = process.env.PREFIX;
	if (!raw) return null;
	const list = raw.split(',').map(normalize).filter(Boolean);
	for (const p of list) {
		if (!validatePrefix(p).ok) throw new Error(`Configuration error: invalid prefix "${p}" in PREFIX.`);
	}
	return list.length ? list : null;
}

/** Active prefixes, longest first so multi-char prefixes win matching. */
export function getPrefixes() {
	const source = runtimePrefixes || envPrefixes() || DEFAULT_PREFIXES;
	const seen = new Set();
	return [...source].filter((p) => (seen.has(p) ? false : (seen.add(p), true))).sort((a, b) => b.length - a.length);
}

/**
 * Parse a message body into command fields. When no configured prefix matches,
 * prefix is '' and the remaining fields are computed exactly like the old
 * parser did (so trigger-only plugins such as eval/exec keep working).
 * @returns {{ prefix: string, command: string, args: string[], text: string, rawText: string, cmd: string }}
 */
export function parseCommand(body) {
	const trimmed = (body || '').trim();
	let prefix = '';
	for (const p of getPrefixes()) {
		if (p && trimmed.startsWith(p)) {
			prefix = p;
			break;
		}
	}
	const after = prefix ? trimmed.slice(prefix.length) : trimmed;
	const args = trimmed.split(/ +/).slice(1);
	const command = after.trim().split(/ +/).shift() || '';
	const cmd = prefix + command;
	const afterCommand = after.trim().slice(command.length);
	const rawText = afterCommand.replace(/^ +/, '');
	return { prefix, command, args, text: args.join(' '), rawText, cmd };
}

export const prefixConfig = () => config;

/**
 * @typedef {Object} Plugin
 * @property {string[]} [commands]
 * @property {(context: Context) => boolean|Promise<boolean>} [match]
 * @property {(context: Context) => any} run
 * @property {'public'|'owner'} [access]
 * @property {string} [category]
 * @property {string} [description]
 */

const VALID_ACCESS = new Set(['public', 'owner']);

/** Validate a plugin module shape; throws with the offending file path. */
export function validatePlugin(plugin, file) {
	const rel = relative(process.cwd(), file);
	const commands = plugin.commands ?? [];
	if (!Array.isArray(commands) || commands.some((c) => typeof c !== 'string' || !c)) {
		throw new Error(`Plugin validation failed: ${rel}\n"commands" must be a non-empty array of strings`);
	}
	const hasCommands = commands.length > 0;
	if (hasCommands === Boolean(plugin.match)) {
		throw new Error(`Plugin validation failed: ${rel}\nProvide exactly one of "commands" or "match"`);
	}
	if (hasCommands && typeof plugin.description !== 'string') {
		throw new Error(`Plugin validation failed: ${rel}\nMissing required field: description`);
	}
	if (typeof plugin?.run !== 'function') throw new Error(`Plugin validation failed: ${rel}\nMissing required field: run`);
	if (plugin.access && !VALID_ACCESS.has(plugin.access)) {
		throw new Error(`Plugin validation failed: ${rel}\n"access" must be 'public' or 'owner'`);
	}
}

/** Single source of truth for registered commands and their metadata. */
export class PluginRegistry {
	constructor() {
		/** @type {Map<string, {plugin: Plugin, file: string}>} command name -> entry */
		this.byCommand = new Map();
		/** @type {Map<string, {plugin: Plugin, file: string, mtimeMs: number}>} file path -> entry */
		this.byFile = new Map();
	}

	/** Register one plugin; throws on duplicate commands. */
	register(plugin, file, mtimeMs) {
		validatePlugin(plugin, file);
		const commands = (plugin.commands || []).map((c) => c.toLowerCase());
		for (const cmd of commands) {
			const existing = this.byCommand.get(cmd);
			if (existing) {
				throw new Error(`Plugin registration failed: command "${cmd}" is already registered by ${relative(process.cwd(), existing.file)}`);
			}
		}
		for (const cmd of commands) this.byCommand.set(cmd, { plugin, file });
		const fileEntry = this.byFile.get(file) || { plugins: [], file, mtimeMs };
		if (!fileEntry.plugins.some((p) => p === plugin)) fileEntry.plugins.push(plugin);
		fileEntry.mtimeMs = mtimeMs;
		this.byFile.set(file, fileEntry);
	}

	/** Replace a file's plugin (hot reload); rolls back to the previous version on failure. */
	replace(file, plugins, mtimeMs) {
		const previous = this.byFile.get(file);
		const oldCommands = previous ? [...this.byCommand.entries()].filter(([, e]) => e.file === file) : [];
		const list = Array.isArray(plugins) ? plugins : [plugins];
		try {
			for (const [cmd] of oldCommands) this.byCommand.delete(cmd);
			this.byFile.delete(file);
			for (const plugin of list) this.register(plugin, file, mtimeMs);
		} catch (err) {
			for (const [cmd, entry] of oldCommands) this.byCommand.set(cmd, entry);
			if (previous) this.byFile.set(file, previous);
			throw err;
		}
	}

	/** Remove a file's plugin from the registry. */
	remove(file) {
		for (const [cmd, entry] of [...this.byCommand.entries()]) if (entry.file === file) this.byCommand.delete(cmd);
		this.byFile.delete(file);
	}

	/** @returns {Plugin|undefined} */
	findCommand(command) {
		if (!command) return undefined;
		return this.byCommand.get(command.toLowerCase())?.plugin;
	}

	/** @returns {{plugin: Plugin, file: string}[]} every registered command plugin */
	getCommands() {
		const out = [];
		for (const entry of this.byFile.values()) {
			for (const plugin of entry.plugins) {
				out.push({ plugin, file: entry.file, primaryCommand: (plugin.commands || [])[0] });
			}
		}
		return out;
	}

	/** @returns {{plugin: Plugin, file: string}[]} */
	getTriggers() {
		return this.getCommands().filter(({ plugin }) => typeof plugin.match === 'function');
	}

	/**
	 * Commands visible to a context; owner-only commands are hidden from non-owners.
	 * @returns {{plugin: Plugin, name: string, aliases: string[]}[]}
	 */
	getVisibleCommands(context) {
		const isOwner = Boolean(context?.isOwner);
		const groups = new Map();
		for (const { plugin } of this.getCommands()) {
			if (!plugin.commands?.length) continue;
			const access = plugin.access || 'public';
			if (access === 'owner' && !isOwner) continue;
			const category = plugin.category || 'general';
			const [name, ...aliases] = plugin.commands || [];
			if (!groups.has(category)) groups.set(category, []);
			groups.get(category).push({ plugin, name, aliases });
		}
		for (const { plugin } of this.getTriggers()) {
			if (!plugin.helpName || !plugin.description) continue;
			const access = plugin.access || 'public';
			if (access === 'owner' && !isOwner) continue;
			const category = plugin.category || 'general';
			if (!groups.has(category)) groups.set(category, []);
			groups.get(category).push({ plugin, name: plugin.helpName, aliases: [] });
		}
		for (const list of groups.values()) list.sort((a, b) => a.name.localeCompare(b.name));
		return groups;
	}
}

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

const normalizeModules = (def) => (Array.isArray(def) ? def : [def]);

/** Load plugins into the registry; throws at startup so a broken plugin never boots silently. */
export async function loadPlugins(registry = new PluginRegistry(), pluginsDir) {
	for (const file of scanPluginFiles(pluginsDir)) {
		const mod = await import(`${file}?load=${Date.now()}`);
		if (!mod.default) continue;
		for (const plugin of normalizeModules(mod.default)) registry.register(plugin, file, statSync(file).mtimeMs);
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
			registry.replace(file, normalizeModules(mod.default), mtimeMs);
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
