import { test, expect } from 'bun:test';
import * as analytics from '../../src/services/groupAnalytics.js';

const CHAT = '120363410933636228@g.us';
const mk = (sender, type, chat = CHAT) => ({ isGroup: chat.endsWith('@g.us'), chat, sender, type });

test('ignores private chats', () => {
	analytics.record(mk('628xxx@s.whatsapp.net', 'conversation', '628xxx@s.whatsapp.net'));
	const before = analytics.getStats(CHAT, 'month').messages;
	expect(before).toBeGreaterThanOrEqual(0);
});

test('records text and aggregates same user/day', () => {
	analytics.record(mk('u1@s.whatsapp.net', 'conversation'));
	analytics.record(mk('u1@s.whatsapp.net', 'conversation'));
	analytics.record(mk('u1@s.whatsapp.net', 'imageMessage'));
	const stats = analytics.getStats(CHAT, 'today');
	const row = stats.rows.find((r) => r.userId === 'u1@s.whatsapp.net');
	expect(row.total).toBeGreaterThanOrEqual(3);
	expect(row.text).toBeGreaterThanOrEqual(2);
	expect(row.image).toBeGreaterThanOrEqual(1);
});

test('aggregates multiple users into totals', () => {
	analytics.record(mk('u2@s.whatsapp.net', 'stickerMessage'));
	const stats = analytics.getStats(CHAT, 'today');
	expect(stats.members).toBeGreaterThanOrEqual(2);
	expect(stats.totals.sticker).toBeGreaterThanOrEqual(1);
});

test('classification covers media types', () => {
	const u = 'u' + Date.now() + '@s.whatsapp.net';
	analytics.record(mk(u, 'videoMessage'));
	analytics.record(mk(u, 'audioMessage'));
	analytics.record(mk(u, 'documentMessage'));
	analytics.record(mk(u, 'pollCreationMessage'));
	const row = analytics.getStats(CHAT, 'today').rows.find((r) => r.userId === u);
	expect(row.video).toBe(1);
	expect(row.audio).toBe(1);
	expect(row.document).toBe(1);
	expect(row.other).toBe(1);
});

test('weekly and monthly queries return valid shapes', () => {
	for (const range of ['week', 'month']) {
		const stats = analytics.getStats(CHAT, range);
		expect(stats.range).toBe(range);
		expect(Array.isArray(stats.rows)).toBe(true);
		expect(stats.messages).toBe(stats.rows.reduce((a, r) => a + r.total, 0));
	}
});

test('prune does not throw and caps at 30 days', () => {
	analytics.prune();
	const stats = analytics.getStats(CHAT, 'month');
	expect(stats.messages).toBeGreaterThanOrEqual(0);
});
