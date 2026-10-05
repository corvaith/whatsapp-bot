import { mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { Database } from 'bun:sqlite';

const connections = new Map();
const WAL_CHECKPOINT_INTERVAL_MS = 10_000;

const checkpointSql = (db) => db.query('PRAGMA wal_checkpoint(PASSIVE)').get();

// Merge WAL ke file utama biar `*.db` tidak terlihat "kosong" ketika dibuka
// tanpa file -wal/-shm (misal viewer SQLite yang tidak WAL-aware).
export function checkpoint(db) {
	if (!db || db.closed) return;
	try {
		checkpointSql(db);
	} catch {}
}

// One connection per database file (shared across imports), WAL tuning applied once.
export function openDatabase(dbPath, { foreignKeys = false } = {}) {
	const path = resolve(dbPath);
	const existing = connections.get(path);
	if (existing) return existing.db;

	mkdirSync(dirname(path), { recursive: true });

	const db = new Database(path);
	db.run('PRAGMA journal_mode = WAL;');
	db.run('PRAGMA synchronous = NORMAL;');
	if (foreignKeys) db.run('PRAGMA foreign_keys = ON;');

	const timer = setInterval(() => checkpoint(db), WAL_CHECKPOINT_INTERVAL_MS);
	timer.unref?.();

	connections.set(path, { db, timer });
	return db;
}

export function closeAllDatabases() {
	for (const { db, timer } of connections.values()) {
		clearInterval(timer);
		try {
			checkpoint(db);
			db.close();
		} catch {}
	}
	connections.clear();
}

process.once('exit', closeAllDatabases);
process.once('SIGINT', () => {
	closeAllDatabases();
	process.exit(0);
});
process.once('SIGTERM', () => {
	closeAllDatabases();
	process.exit(0);
});
