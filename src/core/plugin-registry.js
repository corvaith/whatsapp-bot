import { relative } from 'path';

/**
 * @typedef {Object} Plugin
 * @property {string[]} [commands]
 * @property {(context: import('./context.js').Context) => boolean|Promise<boolean>} [match]
 * @property {(context: import('./context.js').Context) => any} run
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
		this.byFile.set(file, { plugin, file, mtimeMs });
	}

	/** Replace a file's plugin (hot reload); rolls back to the previous version on failure. */
	replace(file, plugin, mtimeMs) {
		const previous = this.byFile.get(file);
		const oldCommands = previous ? [...this.byCommand.entries()].filter(([, e]) => e.file === file) : [];
		try {
			// remove old mapping first so re-registering the same commands is legal
			for (const [cmd] of oldCommands) this.byCommand.delete(cmd);
			this.byFile.delete(file);
			this.register(plugin, file, mtimeMs);
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

	/** @returns {{plugin: Plugin, file: string}[]} */
	getCommands() {
		const seen = new Set();
		const out = [];
		for (const [cmd, entry] of this.byCommand) {
			if (seen.has(entry.file)) continue;
			seen.add(entry.file);
			out.push({ plugin: entry.plugin, file: entry.file, primaryCommand: (entry.plugin.commands || [])[0] || cmd });
		}
		return out;
	}

	/** @returns {{plugin: Plugin, file: string}[]} */
	getTriggers() {
		return [...this.byFile.values()].filter((e) => typeof e.plugin.match === 'function');
	}

	/**
	 * Commands visible to a context; owner-only commands are hidden from non-owners.
	 * @returns {{plugin: Plugin, name: string, aliases: string[]}[]}
	 */
	getVisibleCommands(context) {
		const isOwner = Boolean(context?.isOwner);
		const groups = new Map();
		for (const { plugin } of this.getCommands()) {
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
