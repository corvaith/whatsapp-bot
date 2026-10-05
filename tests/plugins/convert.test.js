import { test, expect } from 'bun:test';
import { makeConn, makeM } from '../helpers/harness.js';
import { handle } from '../helpers/entry.js';

const realFetch = globalThis.fetch;
function mockConvert(handler) {
	globalThis.fetch = handler;
	return () => (globalThis.fetch = realFetch);
}

const jsonEnvelope = (name, from = 'mp4', to = 'mp3', bytes = 1024) =>
	new Response(JSON.stringify({ success: true, data: { url: `https://pixelyte.local/results/${name}`, filename: name, type: 'convert', from, to, bytes } }), {
		status: 200,
		headers: { 'content-type': 'application/json' },
	});

const fakeMedia = (m, mimetype = 'video/mp4') => {
	m.isMedia = true;
	m.msg = { mimetype };
	m.download = async () => Buffer.from('fake-video-bytes-mp4ftyp');
};

test('convert without media/url/format → help, no API call', async () => {
	let called = false;
	const restore = mockConvert(() => ((called = true), jsonEnvelope('x.mp3')));
	try {
		const conn = makeConn();
		await handle(conn, makeM(conn, { body: '.convert' }));
		expect(called).toBe(false);
		const reply = conn.calls.map((c) => c.payload).find((p) => typeof p === 'string');
		expect(reply).toContain('convert <format>');
	} finally {
		restore();
	}
});

test('convert mp3 on video reply → multipart upload with correct filename, audio result', async () => {
	let seenPath = null;
	let seenForm = null;
	const restore = mockConvert((input, init) => {
		if (String(input).endsWith('/api/convert')) {
			seenPath = String(input);
			seenForm = init.body;
			return jsonEnvelope('out123.mp3');
		}
		expect(String(input)).toContain('/results/out123.mp3');
		// minimal mp3 (ID3 header) so file-type detects audio/mpeg
		return new Response(new Uint8Array(Buffer.concat([Buffer.from('000000206674797069736f6d6176633100000000', 'hex'), Buffer.alloc(512)])), { status: 200 });
	});
	try {
		const conn = makeConn();
		const m = makeM(conn, { body: '.convert mp3', isQuoted: true });
		const quoted = makeM(conn, { body: 'video' });
		fakeMedia(quoted);
		m.quoted = quoted;
		await handle(conn, m);
		expect(seenPath).toContain('/api/convert');
		expect(seenForm instanceof FormData).toBe(true);
		expect(seenForm.get('to')).toBe('mp3');
		// mp4 magic detected → upload.mp4, not upload.jpg
		expect(seenForm.get('file')).toBeTruthy();
		const video = conn.calls.map((c) => c.payload).find((p) => p && typeof p === 'object' && p.video);
		expect(Buffer.isBuffer(video.video)).toBe(true);
	} finally {
		restore();
	}
});

test('convert with URL → JSON body {url, to}, result as document', async () => {
	let seenInit = null;
	const restore = mockConvert((input, init) => {
		if (String(input).endsWith('/api/convert')) {
			seenInit = init;
			expect(init.headers['content-type']).toBe('application/json');
			expect(JSON.parse(init.body)).toEqual({ url: 'https://host.local/foto.webp', to: 'png' });
			return jsonEnvelope('outimg.png', 'webp', 'png');
		}
		return new Response(new Uint8Array(Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')), { status: 200 });
	});
	try {
		const conn = makeConn();
		await handle(conn, makeM(conn, { body: '.convert png https://host.local/foto.webp' }));
		expect(seenInit).toBeTruthy();
		const image = conn.calls.map((c) => c.payload).find((p) => p && typeof p === 'object' && p.image);
		expect(Buffer.isBuffer(image.image)).toBe(true);
	} finally {
		restore();
	}
});

test('API rejection (bad format) → error text reaches user, no crash', async () => {
	const restore = mockConvert(
		() =>
			new Response(JSON.stringify({ success: false, error: { code: 'UNSUPPORTED_CONVERSION', message: 'Unsupported conversion: png → zzz.' } }), {
				status: 400,
				headers: { 'content-type': 'application/json' },
			}),
	);
	try {
		const conn = makeConn();
		const m = makeM(conn, { body: '.convert zzz9', isQuoted: true });
		const quoted = makeM(conn, { body: 'video' });
		fakeMedia(quoted);
		m.quoted = quoted;
		await handle(conn, m);
		const reply = conn.calls.map((c) => c.payload).find((p) => typeof p === 'string');
		expect(reply).toContain('Unsupported conversion: png → zzz.');
		expect(conn.calls.some((c) => c.kind === 'react' && c.emoji === '❌')).toBe(true);
	} finally {
		restore();
	}
});

test('oversized input rejected before upload', async () => {
	let called = false;
	const restore = mockConvert(() => ((called = true), jsonEnvelope('x.mp3')));
	try {
		const conn = makeConn();
		const m = makeM(conn, { body: '.convert mp3', isQuoted: true });
		const quoted = makeM(conn, { body: 'video' });
		fakeMedia(quoted);
		m.quoted = quoted;
		m.quoted.download = async () => Buffer.alloc(51 * 1024 * 1024);
		await handle(conn, m);
		expect(called).toBe(false);
		const reply = conn.calls.map((c) => c.payload).find((p) => typeof p === 'string');
		expect(reply).toContain('too large');
	} finally {
		restore();
	}
});

test('oversized output aborted during download', async () => {
	const restore = mockConvert((input, init) => {
		if (String(input).endsWith('/api/convert')) return jsonEnvelope('big.mp3');
		return new Response(
			new ReadableStream({
				start(controller) {
					controller.enqueue(new Uint8Array(1024 * 1024));
					controller.enqueue(new Uint8Array(1024 * 1024));
					controller.close();
				},
			}),
			{ status: 200, headers: { 'content-length': String(200 * 1024 * 1024) } },
		);
	});
	try {
		const conn = makeConn();
		const m = makeM(conn, { body: '.convert mp3', isQuoted: true });
		const quoted = makeM(conn, { body: 'video' });
		fakeMedia(quoted);
		m.quoted = quoted;
		await handle(conn, m);
		const reply = conn.calls.map((c) => c.payload).find((p) => typeof p === 'string');
		expect(reply).toContain('too large');
	} finally {
		restore();
	}
});
