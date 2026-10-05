import { join } from 'path';
import { openDatabase } from '#storage/database.js';
import { setRuntimePrefixes } from '#core/prefix.js';

const db = openDatabase(join('data/database', 'store.db'), { foreignKeys: true });

/** Key-value settings table (backed by store.db) with an in-memory cache. */
class Settings {
	#stmtGet;
	#stmtAll;
	#cache = new Map();

	constructor(db) {
		db.run('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)');
		this.#stmtGet = db.query('SELECT value FROM settings WHERE key = ?');
		this.#stmtAll = db.query('SELECT key, value FROM settings');
		for (const row of this.#stmtAll.all()) this.#cache.set(row.key, row.value);
		const prefixes = this.#cache.get('prefix.global');
		if (prefixes) setRuntimePrefixes(prefixes);
	}

	get(key) {
		return this.#cache.has(key) ? this.#cache.get(key) : this.#stmtGet.get(key)?.value;
	}

	set(key, value) {
		db.query('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
		this.#cache.set(key, value);
	}

	delete(key) {
		db.query('DELETE FROM settings WHERE key = ?').run(key);
		this.#cache.delete(key);
	}
}

export const settings = new Settings(db);
