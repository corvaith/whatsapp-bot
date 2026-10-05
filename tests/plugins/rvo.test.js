import { test, expect } from 'bun:test';
import { makeConn, makeM } from '../helpers/harness.js';

const MP4_HEADER = Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x18]), Buffer.from('ftypmp42'), Buffer.alloc(12)]);

test('rvo: video sent as video, not image', async () => {
	const conn = makeConn({
		async downloadMediaMessage() {
			return MP4_HEADER;
		},
	});
	const m = makeM(conn, { body: '.rvo', isQuoted: true });
	m.quoted = { isMedia: true, download: () => conn.downloadMediaMessage(m) };
	const { default: plugin } = await import('../../src/plugins/media/rvo.js');
	await plugin.run({ conn, m, quoted: m.quoted, downloadMedia: () => conn.downloadMediaMessage(m) });
	expect(conn.calls[0].payload.video).toBeTruthy();
});

test('rvo: real view-once rejected', async () => {
	const conn = makeConn();
	const m = makeM(conn, { body: '.rvo', isQuoted: true });
	m.quoted = { isMedia: true, message: { viewOnceMessageV2: {} }, download: () => conn.downloadMediaMessage(m) };
	const { default: plugin } = await import('../../src/plugins/media/rvo.js');
	await expect(plugin.run({ conn, m, quoted: m.quoted, downloadMedia: () => conn.downloadMediaMessage(m) })).rejects.toBe('Reply to a view-once message.');
});

test('rvo: regular image stays image', async () => {
	const conn = makeConn();
	const m = makeM(conn, { body: '.rvo', isQuoted: true });
	m.quoted = { isMedia: true, download: () => conn.downloadMediaMessage(m) };
	const { default: plugin } = await import('../../src/plugins/media/rvo.js');
	await plugin.run({ conn, m, quoted: m.quoted, downloadMedia: () => conn.downloadMediaMessage(m) });
	expect(conn.calls[0].payload.image).toBeTruthy();
});
