export default function (conn) {
	conn.ev.on('groups.update', (updates) => {
		for (const update of updates) {
			const id = update.id;
			if (conn.groups[id]) {
				conn.groups[id] = {
					...(conn.groups[id] || {}),
					...(update || {}),
				};
			}
		}
	});

	conn.ev.on('group-participants.update', ({ id, participants, action }) => {
		const metadata = conn.groups[id];
		if (!metadata) return;

		switch (action) {
			case 'add':
			case 'revoked_membership_requests':
				for (const p of participants) metadata.participants.push(p);
				break;
			case 'demote':
			case 'promote':
				for (const p of participants) {
					const target = metadata.participants.find((x) => x.id === p.id);
					if (target) {
						target.admin = action === 'promote' ? 'admin' : null;
					}
				}
				break;
			case 'remove':
				conn.groups[id] = {
					...metadata,
					participants: metadata.participants.filter((p) => !participants.includes(p.id)),
				};
				break;
		}
	});
}
