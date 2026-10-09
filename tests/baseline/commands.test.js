import { test, expect } from 'bun:test';
import { makeConn, makeM, wait, normalize } from '../helpers/harness.js';
import { handle } from '../helpers/entry.js';
import { config } from '../../src/config.js';

test('.ping: react then reply, text format', async () => {
	const conn = makeConn();
	await handle(conn, makeM(conn, { body: '.ping' }));
	expect(normalize(conn.calls)).toEqual([
		{ kind: 'react', emoji: '😼' },
		{ kind: 'reply', type: 'text', text: 'Response time: <n> ms' },
	]);
});

test('.PING uppercase still matches', async () => {
	const conn = makeConn();
	await handle(conn, makeM(conn, { body: '.PING' }));
	expect(normalize(conn.calls)).toEqual([
		{ kind: 'react', emoji: '😼' },
		{ kind: 'reply', type: 'text', text: 'Response time: <n> ms' },
	]);
});

test('.help: registry-driven, grouped, owner commands hidden for non-owner', async () => {
	const conn = makeConn();
	await handle(conn, makeM(conn, { body: '.help' }));
	const ownerText = conn.calls[0].payload;
	expect(ownerText).toContain('ꕥ General');
	expect(ownerText).toContain('.help');
	expect(ownerText).toContain('.ping');
	expect(ownerText).toContain('.info');
	expect(ownerText).toContain('ꕥ Media');
	expect(ownerText).toContain('.rvo');
	expect(ownerText).toContain('ꕥ Owner');
	expect(ownerText).toContain('.eval');
	expect(ownerText).toContain('.exec');
	expect(ownerText).toContain('Available Commands');

	config.bot.publicMode = true;
	try {
		const conn2 = makeConn();
		await handle(conn2, makeM(conn2, { body: '.help', fromMe: false, sender: '628111111111@s.whatsapp.net' }));
		const userText = conn2.calls[0].payload;
		expect(userText).toContain('ꕥ General');
		expect(userText).not.toContain('.eval');
		expect(userText).not.toContain('ꕥ Owner');
	} finally {
		config.bot.publicMode = false;
	}
});

test('.info: structure and labels exact (dynamic numbers masked)', async () => {
	const conn = makeConn();
	await handle(conn, makeM(conn, { body: '.info' }));
	const out = normalize(conn.calls);
	expect(out[0]).toEqual({ kind: 'react', emoji: '🍌' });
	const text = conn.calls[1].payload;
	expect(text.startsWith('`Server Information`\n* Bot speed  :')).toBe(true);
	expect(text).toContain('* Bot uptime :');
	expect(text).toContain('* Server uptime :');
	expect(text).toContain('* Memory     :');
	expect(text).toContain('* CPU        :');
	expect(text).toContain('* Release    :');
	expect(text).toContain('* Type       :');
	expect(text).toContain('`Memory Usage`\n* rss          :');
});

test('.rvo with quote: payload { image }', async () => {
	const conn = makeConn();
	const m = makeM(conn, { body: '.rvo', isQuoted: true });
	m.quoted = { isMedia: true, download: () => conn.downloadMediaMessage(m) };
	await handle(conn, m);
	expect(normalize(conn.calls)).toEqual([{ kind: 'reply', type: 'media', media: 'image', size: 16 }]);
});

test('non-owner publicMode=false: nothing sent', async () => {
	config.bot.publicMode = false;
	const conn = makeConn();
	await handle(conn, makeM(conn, { body: '.ping', fromMe: false, sender: '628111111111@s.whatsapp.net' }));
	expect(conn.calls).toEqual([]);
});

test('non-owner publicMode=true: ping runs, eval silent', async () => {
	config.bot.publicMode = true;
	try {
		const conn = makeConn();
		await handle(conn, makeM(conn, { body: '.ping', fromMe: false, sender: '628111111111@s.whatsapp.net' }));
		expect(normalize(conn.calls).length).toBe(2);

		const conn2 = makeConn();
		await handle(conn2, makeM(conn2, { body: '> 1+1', fromMe: false, sender: '628111111111@s.whatsapp.net' }));
		expect(conn2.calls).toEqual([]);
	} finally {
		config.bot.publicMode = false;
	}
});

test('eval: > 1+1, > await ..., => ...', async () => {
	for (const [body, expected] of [
		['> 1+1', '2'],
		['> await Promise.resolve(7)', '7'],
		['=> 3*3', '9'],
	]) {
		const conn = makeConn();
		await handle(conn, makeM(conn, { body }));
		expect(conn.calls[0]?.payload).toBe(expected);
	}
});

test('eval: access b, os, cp, util, quoted, downloadMedia, formatSize, toTime', async () => {
	const conn = makeConn();
	await handle(conn, makeM(conn, { body: '> [typeof b, typeof os, typeof cp, typeof util, typeof quoted, typeof downloadMedia, typeof formatSize, typeof toTime].join()' }));
	expect(conn.calls[0].payload).toBe('object,object,object,object,object,function,function,function');
});

test('eval: error becomes reply', async () => {
	const conn = makeConn();
	await handle(conn, makeM(conn, { body: '> undefinedFn()' }));
	expect(conn.calls[0].payload).toContain('ReferenceError');
});

test('exec: $ echo a, $ ls /nonexistent', async () => {
	const conn = makeConn();
	await handle(conn, makeM(conn, { body: '$ echo a' }));
	await wait(80);
	expect(conn.calls.map((c) => c.payload)).toContain('a\n');

	const conn2 = makeConn();
	await handle(conn2, makeM(conn2, { body: '$ ls /nonexistent_dir_xyz' }));
	await wait(80);
	expect(conn2.calls.map((c) => String(c.payload)).some((t) => t.includes('No such file'))).toBe(true);
});

test('m.isBot: silent', async () => {
	const conn = makeConn();
	await handle(conn, makeM(conn, { body: '.ping', isBot: true }));
	expect(conn.calls).toEqual([]);
});

test('message without body: no crash', async () => {
	const conn = makeConn();
	await handle(conn, makeM(conn, { body: '' }));
	expect(conn.calls).toEqual([]);
});

test('unknown command: no reply', async () => {
	const conn = makeConn();
	await handle(conn, makeM(conn, { body: '.ngasal' }));
	expect(conn.calls).toEqual([]);
});
