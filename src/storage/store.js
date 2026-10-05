import { join } from 'path';
import { openDatabase, checkpoint } from '#storage/database.js';

const db = openDatabase(join('data/database', 'store.db'), { foreignKeys: true });

const rowToObj = (row, cols) => {
	if (!row) return undefined;
	const out = {};
	for (const c of cols) out[c.prop] = row[c.name] ?? undefined;
	return out;
};

const objToRow = (obj, cols) => {
	const row = {};
	for (const c of cols) row[`$${c.name}`] = obj[c.prop] ?? null;
	return row;
};

// Generic SQLite-backed table store: declarative columns, prepared statements,
// transactional batches, optional TTL pruning and an invalidated-on-write cache.
class TableStore {
	#db;
	#table;
	#pk;
	#cols;
	#ttlMs;
	#hasCreatedAt;
	#validate;
	#stmt;
	#upsertManyTxn;
	#listCache = null;
	#cacheValid = false;

	constructor(db, { table, columns, primaryKey = 'id', ttlMs = null, timestamps = false, validate = null }) {
		this.#db = db;
		this.#table = table;
		this.#pk = primaryKey;
		this.#ttlMs = ttlMs;
		this.#validate = validate;
		this.#hasCreatedAt = timestamps || ttlMs > 0;
		this.#cols = this.#hasCreatedAt ? [...columns, { prop: 'created_at', name: 'created_at', type: 'INTEGER NOT NULL' }] : columns;

		this.#createTable();
		this.#compile();
	}

	#createTable() {
		const cols = this.#cols.map((c) => `${c.name} ${c.type}`).join(',\n\t\t');
		this.#db.run(`CREATE TABLE IF NOT EXISTS ${this.#table} (\n\t\t${cols}\n\t)`);
		if (this.#hasCreatedAt) {
			this.#db.run(`CREATE INDEX IF NOT EXISTS idx_${this.#table}_created_at ON ${this.#table}(created_at)`);
		}
	}

	#compile() {
		const db = this.#db;
		const t = this.#table;
		const pk = this.#pk;

		const updateCols = this.#cols.filter((c) => c.name !== pk);
		const insertCols = this.#cols.map((c) => c.name).join(', ');
		const insertVals = this.#cols.map((c) => `$${c.name}`).join(', ');

		this.#stmt = {
			upsert: updateCols.length
				? db.query(
						`INSERT INTO ${t} (${insertCols})
						 VALUES (${insertVals})
						 ON CONFLICT(${pk}) DO UPDATE SET
						 ${updateCols.map((c) => `${c.name} = COALESCE(excluded.${c.name}, ${t}.${c.name})`).join(',\n\t\t\t\t ')}`,
					)
				: db.query(`INSERT OR IGNORE INTO ${t} (${insertCols}) VALUES (${insertVals})`),
			get: db.query(`SELECT * FROM ${t} WHERE ${pk} = ?`),
			list: db.query(`SELECT * FROM ${t}${this.#hasCreatedAt ? ' ORDER BY created_at DESC' : ''}`),
			count: db.query(`SELECT COUNT(*) AS total FROM ${t}`),
			remove: db.query(`DELETE FROM ${t} WHERE ${pk} = ?`),
			removeManyTxn: db.transaction((ids) => {
				for (const id of ids) this.#stmt.remove.run(id);
			}),
			removeExpired: this.#ttlMs ? db.query(`DELETE FROM ${t} WHERE created_at < ?`) : null,
		};

		this.#upsertManyTxn = db.transaction((rows) => {
			for (const row of rows) this.#stmt.upsert.run(row);
		});
	}

	get(id) {
		if (id == null) return undefined;
		return rowToObj(this.#stmt.get.get(id), this.#cols);
	}

	list() {
		if (this.#cacheValid && this.#listCache) return this.#listCache.slice();
		this.prune();
		this.#listCache = this.#stmt.list.all().map((row) => rowToObj(row, this.#cols));
		this.#cacheValid = true;
		return this.#listCache.slice();
	}

	count() {
		return this.#stmt.count.get().total;
	}

	#accepts(obj) {
		if (!obj?.[this.#pk]) return false;
		return !this.#validate || this.#validate(obj);
	}

	upsert(obj) {
		if (!this.#accepts(obj)) return;
		this.prune();
		const now = Date.now();
		const data = this.#hasCreatedAt ? { ...obj, created_at: obj.created_at ?? now } : obj;
		this.#stmt.upsert.run(objToRow(data, this.#cols));
		this.#invalidate();
		checkpoint(this.#db);
	}

	upsertMany(list) {
		if (!list?.length) return;
		this.prune();
		const now = Date.now();
		const rows = [];
		for (const obj of list) {
			if (!this.#accepts(obj)) continue;
			const data = this.#hasCreatedAt ? { ...obj, created_at: obj.created_at ?? now } : obj;
			rows.push(objToRow(data, this.#cols));
		}
		if (!rows.length) return;

		try {
			this.#upsertManyTxn(rows);
		} catch (err) {
			console.warn(`upsertMany transaction failed on ${this.#table}, falling back to per-row:`, err);
			for (const row of rows) {
				try {
					this.#stmt.upsert.run(row);
				} catch (e) {
					console.error(`Failed to save row in ${this.#table}:`, e);
				}
			}
		}
		this.#invalidate();
		checkpoint(this.#db);
	}

	remove(id) {
		if (id == null) return;
		this.#stmt.remove.run(id);
		this.#invalidate();
	}

	removeMany(ids) {
		if (!ids?.length) return;
		this.#stmt.removeManyTxn(ids);
		this.#invalidate();
		checkpoint(this.#db);
	}

	prune() {
		if (!this.#ttlMs || !this.#stmt.removeExpired) return;
		this.#stmt.removeExpired.run(Date.now() - this.#ttlMs);
	}

	#invalidate() {
		this.#cacheValid = false;
		this.#listCache = null;
	}
}

export const CONTACT_ID_PATTERN = /@(lid|s\.whatsapp\.net)$/;

export const contacts = new TableStore(db, {
	table: 'contacts',
	primaryKey: 'id',
	//validate: (obj) => typeof obj?.id === 'string' && CONTACT_ID_PATTERN.test(obj.id),
	columns: [
		{ prop: 'id', name: 'id', type: 'TEXT NOT NULL PRIMARY KEY' },
		{ prop: 'lid', name: 'lid', type: 'TEXT' },
		{ prop: 'phoneNumber', name: 'phone_number', type: 'TEXT' },
		{ prop: 'name', name: 'name', type: 'TEXT' },
		{ prop: 'notify', name: 'notify', type: 'TEXT' },
		{ prop: 'verifiedName', name: 'verified_name', type: 'TEXT' },
	],
});

export { TableStore };
