import { test, expect, beforeEach } from 'bun:test';
import { makeConn, makeM } from '../helpers/harness.js';
import { invalidateGroupMeta, RESPONSES } from '../../src/services/groupAdmin.js';
import { clearMappings } from '../../src/services/usersJid.js';

beforeEach(() => {
	invalidateGroupMeta();
	clearMappings();
});

const { kick } = await import('../../src/plugins/group/moderation.js');
const { promote } = await import('../../src/plugins/group/moderation.js');
const { demote } = await import('../../src/plugins/group/moderation.js');

const GROUP = '120363266695497067@g.us';
const BOT_JID = '6285719563093@s.whatsapp.net';
const SENDER = '628999000111@s.whatsapp.net';
const TARGET = '628111222333@s.whatsapp.net';
const ADMIN_TARGET = '628777888999@s.whatsapp.net';
const STRANGER = '628000111222@s.whatsapp.net';

function meta() {
	return {
		subject: 'Test Group',
		participants: [
			{ id: BOT_JID, admin: 'admin' },
			{ id: SENDER, admin: 'admin' },
			{ id: TARGET, admin: null },
			{ id: ADMIN_TARGET, admin: 'admin' },
			{ id: '628444555666@s.whatsapp.net', admin: null },
		],
	};
}

function mockConn() {
	const conn = makeConn();
	conn.groupMetadata = async () => meta();
	conn.getJid = (j) => j;
	conn.parseJid = (j) => j;
	conn.groupParticipantsUpdate = async (chat, participants, action) => {
		conn.calls.push({ kind: 'update', chat, participants, action });
		return [{ status: '200', jid: participants[0] }];
	};
	return conn;
}

/** LID-mode metadata: participants keyed by @lid with a phoneNumber side-channel. */
function lidMeta() {
	const toLid = (pn) => `${pn.split('@')[0]}@lid`;
	return {
		subject: 'LID Group',
		participants: meta().participants.map((p) => ({
			id: toLid(p.id),
			lid: toLid(p.id),
			phoneNumber: p.id,
			admin: p.admin,
		})),
	};
}

function makeGroupM(conn, fields = {}) {
	const m = makeM(conn, { ...fields, body: fields.body ?? '.kick', sender: SENDER });
	m.isGroup = true;
	m.chat = fields.chatSeed ? `${fields.chatSeed}@g.us` : GROUP;
	return m;
}

function lastUpdate(conn) {
	return conn.calls.find((c) => c.kind === 'update');
}
function lastReply(conn) {
	return conn.calls.filter((c) => c.kind === 'reply').at(-1)?.payload;
}

const targetFor = (action) => (action === 'demote' ? ADMIN_TARGET : TARGET);

for (const [name, plugin, action] of [
	['kick', kick, 'remove'],
	['promote', promote, 'promote'],
	['demote', demote, 'demote'],
]) {
	const TGT = targetFor(action);

	test(`${name}: LID-mode group — sender admin via phoneNumber mapping`, async () => {
		const conn = mockConn();
		conn.groupMetadata = async () => lidMeta();
		const m = makeGroupM(conn, { body: `.${name}`, sender: `${SENDER.split('@')[0]}@lid`, chatSeed: 'lid1' });
		m.msg = { contextInfo: { mentionedJid: [TGT] } };
		await plugin.run({ m, conn, args: [] });
		expect(lastUpdate(conn)?.action).toBe(action);
	});

	test(`${name}: LID sender, PN-keyed metadata`, async () => {
		const conn = mockConn();
		const m = makeGroupM(conn, { body: `.${name}`, sender: `${SENDER.split('@')[0]}@lid`, chatSeed: 'lid2' });
		m.msg = { contextInfo: { mentionedJid: [TGT] } };
		await plugin.run({ m, conn, args: [] });
		expect(lastUpdate(conn)?.action).toBe(action);
	});

	test(`${name}: mention target executes with correct action`, async () => {
		const conn = mockConn();
		const m = makeGroupM(conn, { body: `.${name}` });
		m.msg = { contextInfo: { mentionedJid: [TGT] } };
		await plugin.run({ m, conn, args: m.args });
		const upd = lastUpdate(conn);
		expect(upd).toBeDefined();
		expect(upd.action).toBe(action);
		expect(upd.chat).toBe(GROUP);
		expect(lastReply(conn)).toContain(TGT.split('@')[0]);
	});

	test(`${name}: reply target`, async () => {
		const conn = mockConn();
		const m = makeGroupM(conn, { body: `.${name}`, isQuoted: true });
		m.quoted = { sender: TGT };
		await plugin.run({ m, conn, args: [] });
		expect(lastUpdate(conn)?.participants?.[0]).toBe(TGT);
	});

	test(`${name}: raw number argument`, async () => {
		const conn = mockConn();
		const m = makeGroupM(conn, { body: `.${name} ${TGT.split('@')[0]}` });
		await plugin.run({ m, conn, args: m.args });
		expect(lastUpdate(conn)?.participants?.[0]).toBe(TGT);
	});

	test(`${name}: sender not admin → rejected before any update`, async () => {
		const conn = mockConn();
		conn.groupMetadata = async () => ({
			participants: [
				{ id: BOT_JID, admin: 'admin' },
				{ id: SENDER, admin: null },
				{ id: TGT, admin: action === 'demote' ? 'admin' : null },
			],
		});
		const m = makeGroupM(conn, { body: `.${name}` });
		m.msg = { contextInfo: { mentionedJid: [TGT] } };
		await plugin.run({ m, conn, args: [] });
		expect(lastUpdate(conn)).toBeUndefined();
		expect(lastReply(conn)).toBe('Only group admins can use this command.');
	});

	test(`${name}: bot not admin → rejected`, async () => {
		const conn = mockConn();
		conn.groupMetadata = async () => ({
			participants: [
				{ id: BOT_JID, admin: null },
				{ id: SENDER, admin: 'admin' },
				{ id: TGT, admin: action === 'demote' ? 'admin' : null },
			],
		});
		const m = makeGroupM(conn, { body: `.${name}` });
		m.msg = { contextInfo: { mentionedJid: [TGT] } };
		await plugin.run({ m, conn, args: [] });
		expect(lastUpdate(conn)).toBeUndefined();
		expect(lastReply(conn)).toBe('I need to be a group admin to do that.');
	});

	test(`${name}: non-group chat → rejected`, async () => {
		const conn = mockConn();
		const m = makeM(conn, { body: `.${name}` });
		m.msg = { contextInfo: { mentionedJid: [TGT] } };
		await plugin.run({ m, conn, args: [] });
		expect(lastUpdate(conn)).toBeUndefined();
		expect(lastReply(conn)).toBe('This command can only be used in a group.');
	});

	test(`${name}: no target → usage hint`, async () => {
		const conn = mockConn();
		const m = makeGroupM(conn, { body: `.${name}` });
		await plugin.run({ m, conn, args: [] });
		expect(lastUpdate(conn)).toBeUndefined();
		expect(lastReply(conn)).toContain(m.prefix);
	});

	test(`${name}: API failure status surfaces`, async () => {
		const conn = mockConn();
		conn.groupParticipantsUpdate = async () => [{ status: '403', jid: TGT }];
		const m = makeGroupM(conn, { body: `.${name}` });
		m.msg = { contextInfo: { mentionedJid: [TGT] } };
		await plugin.run({ m, conn, args: [] });
		expect(lastReply(conn)).toContain('403');
	});
}

for (const [name, plugin] of [
	['kick', kick],
	['promote', promote],
	['demote', demote],
]) {
	test(`${name}: target not in group → rejected locally`, async () => {
		const conn = mockConn();
		const m = makeGroupM(conn, { body: `.${name}` });
		m.msg = { contextInfo: { mentionedJid: [STRANGER] } };
		await plugin.run({ m, conn, args: [] });
		expect(lastUpdate(conn)).toBeUndefined();
		expect(lastReply(conn)).toBe(RESPONSES.notInGroup.replace('{num}', STRANGER.split('@')[0]));
	});
}

test('promote: target already admin → rejected locally', async () => {
	const conn = mockConn();
	const m = makeGroupM(conn, { body: '.promote' });
	m.msg = { contextInfo: { mentionedJid: [ADMIN_TARGET] } };
	await promote.run({ m, conn, args: [] });
	expect(lastUpdate(conn)).toBeUndefined();
	expect(lastReply(conn)).toBe(RESPONSES.alreadyAdmin.replace('{num}', ADMIN_TARGET.split('@')[0]));
});

test('demote: target is already a plain member → rejected locally', async () => {
	const conn = mockConn();
	const m = makeGroupM(conn, { body: '.demote' });
	m.msg = { contextInfo: { mentionedJid: [TARGET] } };
	await demote.run({ m, conn, args: [] });
	expect(lastUpdate(conn)).toBeUndefined();
	expect(lastReply(conn)).toBe(RESPONSES.targetNotAdmin.replace('{num}', TARGET.split('@')[0]));
});

test('validation reads fresh metadata after a role change (no stale admin)', async () => {
	const conn = mockConn();
	conn.groupMetadata = async () => (conn.calls.some((c) => c.kind === 'update') ? { participants: meta().participants.map((p) => (p.id === TARGET ? { ...p, admin: 'admin' } : p)) } : meta());
	const m = makeGroupM(conn, { body: '.promote' });
	m.msg = { contextInfo: { mentionedJid: [TARGET] } };
	await promote.run({ m, conn, args: [] });
	expect(lastUpdate(conn)?.action).toBe('promote');
	await promote.run({ m, conn, args: [] });
	expect(lastReply(conn)).toBe(RESPONSES.alreadyAdmin.replace('{num}', TARGET.split('@')[0]));
});
