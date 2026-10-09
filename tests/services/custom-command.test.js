import { test, expect } from 'bun:test';
import { stickerHash, findByStickerHash, create, get, remove, expiresAt } from '../../src/services/commands.js';
import { linkJids, clearMappings } from '../../src/services/usersJid.js';

const HASH = 'deadbeef' + '0'.repeat(48);

test('create + findByStickerHash round-trip', () => {
	const entry = create({ stickerHash: HASH, command: 'Ping', createdBy: '6285719563093@s.whatsapp.net' });
	expect(entry.id).toMatch(/^SC-[0-9A-F]{4}$/);
	expect(entry.command).toBe('ping');
	expect(get(entry.id).stickerHash).toBe(HASH);
	expect(findByStickerHash(HASH)?.command).toBe('ping');
	remove(entry.id);
	expect(get(entry.id)).toBeUndefined();
});

test('createdBy is stored as the LID form when the pair is known', () => {
	clearMappings();
	linkJids('6285719563093@s.whatsapp.net', '95146947420302@lid');
	const entry = create({ stickerHash: HASH + 'lid', command: 'ping', createdBy: '6285719563093@s.whatsapp.net' });
	expect(entry.createdBy).toBe('95146947420302@lid');
	expect(get(entry.id).createdBy).toBe('95146947420302@lid');
	remove(entry.id);
	clearMappings();
});

test('duplicate sticker hash detected', () => {
	const a = create({ stickerHash: HASH + 'a', command: 'ping', createdBy: 'x' });
	const found = findByStickerHash(HASH + 'a');
	expect(found.command).toBe('ping');
	expect(found.id).toBe(a.id);
	remove(a.id);
});

test('expiry is 7 days out', () => {
	const entry = create({ stickerHash: HASH + 'b', command: 'help', createdBy: 'x' });
	const stored = get(entry.id);
	expect(expiresAt(stored) - stored.created_at).toBe(7 * 86_400_000);
	remove(entry.id);
});

test('owner-only target protection is dispatcher-side (stickerHash deterministic)', () => {
	expect(stickerHash(Buffer.from('abc'))).toBe(stickerHash(Buffer.from('abc')));
	expect(stickerHash(Buffer.from('abc'))).not.toBe(stickerHash(Buffer.from('abd')));
});
