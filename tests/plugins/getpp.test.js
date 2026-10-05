import { test, expect } from 'bun:test';
import { makeConn, makeM } from '../helpers/harness.js';

const plugin = (await import('../../src/plugins/tools/getpp.js')).default;

function makeCtx(m, conn) {
	return { m, conn, args: m.args || [], prefix: m.prefix || '.' };
}

function mockConn() {
	const conn = makeConn();
	conn.profilePictureUrl = async (jid) => `https://cdn.test/pp/${jid}.jpg`;
	conn.getBusinessProfile = async () => undefined;
	conn.getJid = (jid) => jid;
	return conn;
}

test('getpp: mention target wins', async () => {
	const conn = mockConn();
	const m = makeM(conn, { body: '.getpp' });
	m.msg = { contextInfo: { mentionedJid: ['628111@s.whatsapp.net'] } };
	await plugin.run(makeCtx(m, conn));
	const payload = conn.calls.find((c) => c.kind === 'reply')?.payload;
	expect(payload.image.url).toBe('https://cdn.test/pp/628111@s.whatsapp.net.jpg');
	expect(payload.caption).toContain('628111');
});

test('getpp: quoted sender target', async () => {
	const conn = mockConn();
	const m = makeM(conn, { body: '.getpp', isQuoted: true });
	m.quoted = { sender: '628222@s.whatsapp.net' };
	await plugin.run(makeCtx(m, conn));
	const payload = conn.calls.find((c) => c.kind === 'reply')?.payload;
	expect(payload.image.url).toContain('628222');
});

test('getpp: me and raw number arguments', async () => {
	const conn = mockConn();
	const m = makeM(conn, { body: '.getpp me' });
	m.args = ['me'];
	await plugin.run(makeCtx(m, conn));
	expect(conn.calls.find((c) => c.kind === 'reply')?.payload.image.url).toContain(m.sender);

	const conn2 = mockConn();
	const m2 = makeM(conn2, { body: '.getpp 628333999' });
	m2.args = ['628333999'];
	await plugin.run(makeCtx(m2, conn2));
	expect(conn2.calls.find((c) => c.kind === 'reply')?.payload.image.url).toContain('628333999@s.whatsapp.net');
});

test('getpp: default in private chat is the other person; missing picture → friendly error', async () => {
	const conn = mockConn();
	const m = makeM(conn, { body: '.getpp' });
	m.args = [];
	await plugin.run(makeCtx(m, conn));
	expect(conn.calls.find((c) => c.kind === 'reply')?.payload.image.url).toContain(m.chat);

	const conn2 = mockConn();
	conn2.profilePictureUrl = async () => {
		throw new Error('item-not-found');
	};
	const m2 = makeM(conn2, { body: '.getpp' });
	m2.args = [];
	await plugin.run(makeCtx(m2, conn2));
	const reply = conn2.calls.find((c) => c.kind === 'reply')?.payload;
	expect(reply).toContain('not found or privacy');
	expect(conn2.calls.some((c) => c.kind === 'react' && c.emoji === '❌')).toBe(true);
});

test('getpp: business query failure does not break the picture reply', async () => {
	const conn = mockConn();
	conn.getBusinessProfile = async () => {
		throw new Error('boom');
	};
	const m = makeM(conn, { body: '.getpp me' });
	m.args = ['me'];
	await plugin.run(makeCtx(m, conn));
	expect(conn.calls.find((c) => c.kind === 'reply')?.payload.image.url).toBeTruthy();
});

test('getpp group: works in group, rejected in private', async () => {
	const conn = mockConn();
	const m = makeM(conn, { body: '.getpp group', isGroup: true, chat: '1203@g.us' });
	m.args = ['group'];
	await plugin.run(makeCtx(m, conn));
	expect(conn.calls.find((c) => c.kind === 'reply')?.payload.image.url).toContain('1203@g.us');

	const conn2 = mockConn();
	const m2 = makeM(conn2, { body: '.getpp group', isGroup: false });
	m2.args = ['group'];
	await plugin.run(makeCtx(m2, conn2));
	expect(conn2.calls.find((c) => c.kind === 'reply')?.payload).toContain('only works in groups');
});
