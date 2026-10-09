import { test, expect } from 'bun:test';
import { linkJids, linkFromMetadata, toLid, toPn, isLid, clearMappings } from '../../src/services/usersJid.js';

const PN = '628123456789@s.whatsapp.net';
const LID = '95146947420302@lid';

test('linkJids + lookups', () => {
	clearMappings();
	expect(toLid(PN)).toBe(PN);
	linkJids(PN, LID);
	expect(toLid(PN)).toBe(LID);
	expect(toPn(LID)).toBe(PN);
	expect(isLid(toLid(PN))).toBe(true);
	expect(toLid(LID)).toBe(LID);
	expect(toPn(PN)).toBe(PN);
});

test('linkFromMetadata harvests LID+PN pairs', () => {
	clearMappings();
	linkFromMetadata({
		participants: [
			{ id: LID, lid: LID, phoneNumber: PN, admin: 'admin' },
			{ id: '111222333@s.whatsapp.net', admin: null },
		],
	});
	expect(toLid(PN)).toBe(LID);
	expect(toPn(LID)).toBe(PN);
});

test('invalid inputs are ignored', () => {
	clearMappings();
	linkJids('garbage', LID);
	linkJids(PN, 'garbage');
	expect(toLid(PN)).toBe(PN);
	expect(toPn(LID)).toBe(LID);
	expect(toLid(undefined)).toBeUndefined();
});
