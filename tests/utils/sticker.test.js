import { test, expect } from 'bun:test';
import { createSticker, isAnimated, injectExif, buildExif } from '../../src/utils/sticker.js';
import { execFileSync } from 'node:child_process';
import { uguu, tmpfiles, upload } from '../../src/services/uploader.js';

const frameInfo = (path) =>
	execFileSync('python3', ['-c', `from PIL import Image; im=Image.open('${path}'); px=im.convert('RGBA').getpixel((0,0)); print(getattr(im,'n_frames',1), im.size[0], px, sep='|')`])
		.toString()
		.trim()
		.split('|');

test('createSticker: 16:9 photo → transparent padding, not white', async () => {
	execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=1', '-frames:v', '1', '/tmp/sk16.jpg'], { stdio: 'ignore' });
	const { readFile, writeFile } = await import('node:fs/promises');
	const img = await readFile('/tmp/sk16.jpg');
	const sticker = await createSticker(img, { pack: 'PK', author: 'AU' });
	await writeFile('/tmp/sk16-out.webp', sticker);
	const [frames, , corner] = frameInfo('/tmp/sk16-out.webp');
	expect(frames).toBe('1');
	expect(corner).toBe('(255, 255, 255, 0)');
}, 30000);

test('createSticker: video → animated sticker with many frames and transparency', async () => {
	execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=15', '-t', '2', '/tmp/skvid.mp4'], { stdio: 'ignore' });
	const { readFile, writeFile } = await import('node:fs/promises');
	const vid = await readFile('/tmp/skvid.mp4');
	const sticker = await createSticker(vid, { animated: true, pack: 'PK', author: 'AU' });
	await writeFile('/tmp/skvid-out.webp', sticker);
	const [frames, , corner] = frameInfo('/tmp/skvid-out.webp');
	expect(Number(frames)).toBeGreaterThan(5);
	expect(corner).toBe('(255, 255, 255, 0)');
}, 60000);

test('createSticker: gif treated as animated via isAnimated', () => {
	const gif = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(20)]);
	expect(isAnimated(gif, 'image/gif')).toBe(true);
	const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPANIM'), Buffer.alloc(20)]);
	expect(isAnimated(webp, 'image/webp')).toBe(true);
	const still = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(20)]);
	expect(isAnimated(still, 'image/webp')).toBe(false);
	expect(isAnimated(Buffer.from('000000206674797069736f6d', 'hex'), 'video/mp4')).toBe(true);
	expect(isAnimated(Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'), 'image/png')).toBe(false);
});

test('createSticker: animated webp → Pillow re-encode keeps animation', async () => {
	execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc=size=300x200:rate=15', '-t', '1', '-c:v', 'libwebp', '-loop', '0', '/tmp/skanim.webp'], { stdio: 'ignore' });
	const { readFile, writeFile } = await import('node:fs/promises');
	const webp = await readFile('/tmp/skanim.webp');
	const sticker = await createSticker(webp, { pack: 'PK', author: 'AU' });
	await writeFile('/tmp/skanim-out.webp', sticker);
	const [frames] = frameInfo('/tmp/skanim-out.webp');
	expect(Number(frames)).toBeGreaterThan(1);
}, 60000);

test('injectExif: VP8X first, EXIF last, RIFF size correct, alpha/anim flags intact', async () => {
	execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc=size=300x200:rate=10', '-t', '1', '-c:v', 'libwebp', '-loop', '0', '/tmp/skchunk.webp'], { stdio: 'ignore' });
	const { readFile, writeFile } = await import('node:fs/promises');
	const webp = await readFile('/tmp/skchunk.webp');
	const out = injectExif(webp, buildExif('PK', 'AU'));
	expect(out.readUInt32LE(4)).toBe(out.length - 8);
	await writeFile('/tmp/skchunk-out.webp', out);
	const chunks = execFileSync('python3', [
		'-c',
		"import struct; b=open('/tmp/skchunk-out.webp','rb').read(); o=12; c=[]\nwhile o<len(b)-8:\n    cc=b[o:o+4].decode('latin1'); sz=struct.unpack('<I',b[o+4:o+8])[0]; c.append(cc); o+=8+sz+(sz%2)\nprint(','.join(c))",
	])
		.toString()
		.trim();
	expect(chunks.startsWith('VP8X')).toBe(true);
	expect(chunks.endsWith('EXIF')).toBe(true);
	const flags = execFileSync('python3', ['-c', "b=open('/tmp/skchunk-out.webp','rb').read(); print(b[20])"]).toString().trim();
	expect(Number(flags) & 0x02).toBeTruthy();
	expect(Number(flags) & 0x10).toBeTruthy();
	const [frames] = frameInfo('/tmp/skchunk-out.webp');
	expect(Number(frames)).toBeGreaterThan(1);
}, 60000);

test('createSticker: unsupported buffer rejected', async () => {
	await expect(createSticker(Buffer.from('plain text'), {})).rejects.toThrow();
});

test('upload: uguu multipart shape (mocked fetch)', async () => {
	const orig = globalThis.fetch;
	let seenForm = null;
	let seenUrl = '';
	globalThis.fetch = async (url, init) => {
		seenUrl = String(url);
		seenForm = init.body;
		return new Response('{"success":true,"files":[{"url":"https://h.uguu.se/abc.jpg"}]}', { status: 200 });
	};
	try {
		const url = await uguu(Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'), 'img.png');
		expect(url).toBe('https://h.uguu.se/abc.jpg');
		expect(seenUrl).toContain('uguu');
		expect(seenForm).toBeInstanceOf(FormData);
	} finally {
		globalThis.fetch = orig;
	}
});

test('upload: tmpfiles extracts raw /dl/<token>/<name> link from page (mocked)', async () => {
	const orig = globalThis.fetch;
	let step = 0;
	globalThis.fetch = async () => {
		step += 1;
		if (step === 1) return new Response('{"status":"success","data":{"url":"https://tmpfiles.org/abCDE/img.png"}}', { status: 200 });
		return new Response('<html><img src="https://tmpfiles.org/dl/1791208.tok/abCDE/img.png"></html>', { status: 200 });
	};
	try {
		const url = await tmpfiles(Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'), 'img.png');
		expect(url).toBe('https://tmpfiles.org/dl/1791208.tok/abCDE/img.png');
	} finally {
		globalThis.fetch = orig;
	}
});

test('upload: no provider → default chain, first success wins (mocked)', async () => {
	const orig = globalThis.fetch;
	let step = 0;
	globalThis.fetch = async () => {
		step += 1;
		if (step === 1) return new Response('{"success":false}', { status: 500 });
		if (step === 2) return new Response('{"status":"success","data":{"url":"https://tmpfiles.org/abCDE/img.png"}}', { status: 200 });
		return new Response('<html>https://tmpfiles.org/dl/123.tok/abCDE/img.png</html>', { status: 200 });
	};
	try {
		const url = await upload(Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'), 'img.png');
		expect(url).toBe('https://tmpfiles.org/dl/123.tok/abCDE/img.png');
	} finally {
		globalThis.fetch = orig;
	}
});

test('upload: unknown named provider throws', async () => {
	await expect(upload(Buffer.from('x'), 'f.bin', 'doesnotexist')).rejects.toThrow();
});
