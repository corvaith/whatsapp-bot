import { test, expect } from 'bun:test';
import * as savedMessage from '../../src/services/saved-message.js';

const CHAT = '120363410999999999@g.us';

test('save + lookup text message', async () => {
	const entry = await savedMessage.save({
		chatId: CHAT,
		ownerId: '6285719563093@s.whatsapp.net',
		m: {
			type: 'conversation',
			quoted: { type: 'conversation', message: { conversation: 'hello world' }, body: 'hello world' },
		},
	});
	expect(entry.id).toMatch(/^SM-[0-9A-F]{4}$/);
	savedMessage.setKeyword(entry.id, 'quote');
	expect(savedMessage.findByKeyword(CHAT, 'quote')?.id).toBe(entry.id);
	expect(savedMessage.findByKeyword('other@g.us', 'quote')).toBeUndefined(); // chat isolation
	await savedMessage.remove(entry.id);
	expect(savedMessage.get(entry.id)).toBeUndefined();
});

test('duplicate keyword is detectable before save', async () => {
	const a = await savedMessage.save({ chatId: CHAT, ownerId: 'x', m: { type: 'conversation', quoted: { type: 'conversation', message: { conversation: 'a' }, body: 'a' } } });
	savedMessage.setKeyword(a.id, 'dup');
	expect(savedMessage.findByKeyword(CHAT, 'dup')).toBeDefined();
	// second save with same keyword must be rejected by plugin layer, not silently overwrite
	await savedMessage.remove(a.id);
});

test('media save writes file and remove deletes it (no orphans)', async () => {
	const fakePng = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
	const entry = await savedMessage.save({
		chatId: CHAT,
		ownerId: 'x',
		m: {
			type: 'imageMessage',
			quoted: {
				type: 'imageMessage',
				isMedia: true,
				msg: { mimetype: 'image/png' },
				message: { imageMessage: { mimetype: 'image/png' } },
				download: async () => fakePng,
			},
		},
	});
	expect(entry.mediaPath).toBeTruthy();
	const { existsSync } = await import('fs');
	const p = (await import('path')).join(process.cwd(), entry.mediaPath);
	expect(existsSync(p)).toBe(true);
	await savedMessage.remove(entry.id);
	expect(existsSync(p)).toBe(false); // orphan cleanup
});

test('remove returns false for unknown ID', async () => {
	expect(await savedMessage.remove('SM-ZZZZ')).toBe(false);
});
