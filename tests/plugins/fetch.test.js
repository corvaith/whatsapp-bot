import { test, expect, mock } from 'bun:test';
import { makeConn, makeM } from '../helpers/harness.js';
import { handle } from '../helpers/entry.js';
import { request } from '../../src/utils/http.js';
import { tokenize } from '../../src/utils/arguments.js';
import { guardUrl } from '../../src/utils/network.js';

const realFetch = globalThis.fetch;
function mockFetch(handler) {
	globalThis.fetch = async (input, init) => handler(input, init);
	return () => (globalThis.fetch = realFetch);
}

test('tokenize: quotes and smart quotes', () => {
	expect(tokenize('--data \'{"a": "x y"}\'')).toEqual(['--data', '{"a": "x y"}']);
	expect(tokenize('--data “k: v”')).toEqual(['--data', 'k: v']);
	expect(tokenize('a  b\t c')).toEqual(['a', 'b', 'c']);
});

test('guardUrl blocks private targets', async () => {
	expect(await guardUrl('http://127.0.0.1:3109/')).toContain('not allowed');
	expect(await guardUrl('http://169.254.169.254/latest')).toContain('not allowed');
	expect(await guardUrl('http://192.168.1.5/')).toContain('not allowed');
	expect(await guardUrl('ftp://example.com/')).toContain('Only http');
	expect(await guardUrl('not a url')).toContain('Invalid');
	expect(await guardUrl('http://[::1]/')).toContain('not allowed');
});

test('guardUrl allows public hosts', async () => {
	expect(await guardUrl('https://example.com/')).toBeUndefined();
});

test('request: manual redirect loop with guard re-check', async () => {
	const restore = mockFetch((input) => {
		const url = String(input);
		if (url.includes('/step1')) {
			return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/step2' } });
		}
		return new Response('nope', { status: 200 });
	});
	try {
		const err = await request({ url: 'https://example.com/step1', guard: true, maxRedirects: 5 }).catch((e) => e);
		expect(err.code).toBe('GUARD_BLOCKED');
		const ok = await request({ url: 'https://example.com/step1', guard: false, maxRedirects: 5 });
		expect(ok.status).toBe(200);
		expect(ok.finalUrl).toBe('http://127.0.0.1/step2');
	} finally {
		restore();
	}
});

test('request: maxBytes enforced while streaming', async () => {
	const restore = mockFetch(() => new Response(new Uint8Array(64), { status: 200, headers: { 'content-length': '64' } }));
	try {
		await expect(request({ url: 'https://example.com/big', maxBytes: 32 })).rejects.toMatchObject({ code: 'ETOOBIG' });
		const ok = await request({ url: 'https://example.com/ok', maxBytes: 128 });
		expect(ok.buffer.length).toBe(64);
	} finally {
		restore();
	}
});

test('.fetch GET JSON → pretty reply; invalid URL → friendly error', async () => {
	const restore = mockFetch((input, init) => {
		expect(String(input)).toBe('https://httpbin.local/get');
		return new Response(JSON.stringify({ url: String(input), hello: 'world' }), { status: 200, headers: { 'content-type': 'application/json' } });
	});
	try {
		const conn = makeConn();
		await handle(conn, makeM(conn, { body: '.fetch https://httpbin.local/get' }));
		expect(conn.calls.some((c) => c.kind === 'react' && c.emoji === '✅')).toBe(true);
		const reply = conn.calls.map((c) => c.payload).find((p) => typeof p === 'string');
		expect(reply).toContain('*200');
		expect(reply).toContain('"hello": "world"');

		const conn2 = makeConn();
		await handle(conn2, makeM(conn2, { body: '.fetch ftp://x.y/z' }));
		expect(conn2.calls.at(-1).payload).toContain('Only http');
	} finally {
		restore();
	}
});

test('.fetch POST with raw JSON body (rawText with double spaces intact)', async () => {
	let receivedBody = null;
	const restore = mockFetch((input, init) => {
		receivedBody = init?.body;
		return new Response('{"ok":true}', { status: 201, headers: { 'content-type': 'application/json' } });
	});
	try {
		const conn = makeConn();
		await handle(conn, makeM(conn, { body: '.fetch https://httpbin.local/post -X POST -H \'Content-Type: application/json\' -d {"a": 1,  "b": [2, 3]}' }));
		expect(String(receivedBody)).toBe('{"a": 1,  "b": [2, 3]}');
		const reply = conn.calls.map((c) => c.payload).find((p) => typeof p === 'string');
		expect(reply).toContain('*201');
	} finally {
		restore();
	}
});

test('.fetch reply to a curl command message', async () => {
	const restore = mockFetch((input, init) => new Response(JSON.stringify({ fine: 1 }), { status: 200, headers: { 'content-type': 'application/json' } }));
	try {
		const conn = makeConn();
		const m = makeM(conn, { body: '.fetch', isQuoted: true });
		m.quoted = { ...m, body: 'curl -X POST https://httpbin.local/post' };
		await handle(conn, m);
		const reply = conn.calls.map((c) => c.payload).find((p) => typeof p === 'string');
		expect(reply).toContain('200');
	} finally {
		restore();
	}
});

test('.fetch HEAD → status + headers only', async () => {
	const restore = mockFetch((input, init) => new Response(null, { status: 200, headers: { 'content-type': 'text/html', 'x-test': 'yes' } }));
	try {
		const conn = makeConn();
		await handle(conn, makeM(conn, { body: '.fetch -I https://httpbin.local/' }));
		const reply = conn.calls.map((c) => c.payload).find((p) => typeof p === 'string');
		expect(reply).toContain('x-test: yes');
	} finally {
		restore();
	}
});

test('.fetch binary image → image payload', async () => {
	const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
	const restore = mockFetch(() => new Response(new Uint8Array(png), { status: 200, headers: { 'content-type': 'image/png' } }));
	try {
		const conn = makeConn();
		await handle(conn, makeM(conn, { body: '.fetch https://httpbin.local/img.png' }));
		const payload = conn.calls.map((c) => c.payload).find((p) => p && typeof p === 'object' && p.image);
		expect(Buffer.isBuffer(payload.image)).toBe(true);
		expect(payload.caption).toContain('200');
	} finally {
		restore();
	}
});
