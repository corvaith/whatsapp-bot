import { contacts } from '#storage/store.js';

export default function (conn) {
	conn.pendingContactSaves = 0;
	conn.ev.on('contacts.upsert', (update) => upsertContacts(conn, update));
}

function upsertContacts(conn, update) {
	conn.pendingContactSaves++;
	try {
		const rows = [];
		for (const contact of update) {
			rows.push({
				id: contact.id,
				lid: contact.lid,
				phoneNumber: contact.phoneNumber,
				name: contact.name,
				notify: contact.notify,
				verifiedName: contact.verifiedName,
			});
		}

		contacts.upsertMany(rows);
	} catch (err) {
		conn.logger.error('Failed to save contacts:', err);
	} finally {
		conn.pendingContactSaves--;
	}
}
