import { join } from 'path';

import { openDatabase } from '#storage/database.js';
import { applyRuntimeMode } from '#config/environment.js';

const db = openDatabase(join('data/database', 'store.db'));
db.run(`CREATE TABLE IF NOT EXISTS bot_settings (
	key TEXT PRIMARY KEY,
	value TEXT NOT NULL
)`);

const getStmt = db.query('SELECT value FROM bot_settings WHERE key = ?');
const setStmt = db.query('INSERT INTO bot_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');

const KEY = 'mode';

/** Load the persisted mode override at boot; falls back to .env when absent. */
export function loadMode() {
	const row = getStmt.get(KEY);
	applyRuntimeMode(row?.value);
	return row?.value ?? null;
}

/** Persist the current mode so restarts keep it. */
export function saveMode(mode) {
	setStmt.run(KEY, mode);
}
