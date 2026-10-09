import { makeCacheableSignalKeyStore, BufferJSON, initAuthCreds, proto } from 'baileys';
import { join } from 'path';
import { openDatabase } from '#database.js';

export default async function () {
	const { state, saveCreds } = await useSQLiteAuthState(join(process.cwd(), 'data/auth'));
	return {
		saveCreds,
		auth: {
			creds: state.creds,
			keys: makeCacheableSignalKeyStore(state.keys),
		},
	};
}

export const useSQLiteAuthState = async (folder) => {
	const dbPath = join(folder, 'auth.db');
	const db = openDatabase(dbPath);

	db.run(`
		CREATE TABLE IF NOT EXISTS auth (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL
		);
	`);

	const getStmt = db.query('SELECT value FROM auth WHERE key = ?');
	const setStmt = db.query('INSERT OR REPLACE INTO auth (key, value) VALUES (?, ?)');
	const removeStmt = db.query('DELETE FROM auth WHERE key = ?');

	const getData = (key) => {
		const row = getStmt.get(key);
		if (!row) return null;
		return JSON.parse(row.value, BufferJSON.reviver);
	};

	const setData = (key, value) => {
		setStmt.run(key, JSON.stringify(value, BufferJSON.replacer));
	};

	const removeData = (key) => {
		removeStmt.run(key);
	};

	const creds = getData('creds') || initAuthCreds();

	return {
		state: {
			creds,
			keys: {
				get: async (type, ids) => {
					const data = {};
					for (const id of ids) {
						let value = getData(`${type}:${id}`);
						if (type === 'app-state-sync-key' && value) {
							value = proto.Message.AppStateSyncKeyData.fromObject(value);
						}
						data[id] = value;
					}
					return data;
				},
				set: async (data) => {
					for (const category in data) {
						for (const id in data[category]) {
							const value = data[category][id];
							const key = `${category}:${id}`;
							if (value) {
								setData(key, value);
							} else {
								removeData(key);
							}
						}
					}
				},
			},
		},
		saveCreds: async () => {
			setData('creds', creds);
		},
	};
};
