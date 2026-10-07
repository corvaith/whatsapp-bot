import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { unlink, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileTypeFromBuffer } from 'file-type';
import webp from 'node-webpmux';

const SIZE = 320;
const MAX_DURATION = 10;
const MAX_STICKER_BYTES = 1024 * 1024;

// ChiiMD-style filter: fit inside 320 (never upscale), transparent pad,
// palette with black-keyed transparency.
const VF = [
	`scale='min(${SIZE},iw)':'min(${SIZE},ih)':force_original_aspect_ratio=decrease`,
	'fps=15',
	`pad=${SIZE}:${SIZE}:-1:-1:color=white@0.0`,
	'split[a][b]',
	'[a]palettegen=reserve_transparent=on:transparency_color=ffffff[p]',
	'[b][p]paletteuse',
].join(',');

function run(args, stdin) {
	return new Promise((resolve, reject) => {
		const proc = spawn(args[0], args.slice(1), { stdio: [stdin ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
		const out = [];
		let err = '';
		proc.stdout.on('data', (d) => out.push(d));
		proc.stderr.on('data', (d) => (err += d));
		proc.on('error', reject);
		proc.on('close', (code) => {
			if (code !== 0) return reject(new Error(err.slice(-300).trim() || `${args[0]} exit ${code}`));
			resolve(Buffer.concat(out));
		});
		if (stdin) proc.stdin.end(stdin);
	});
}

function ffArgs(isVideo) {
	const base = ['-vcodec', 'libwebp', '-vf', VF, '-quality', '80'];
	if (!isVideo) return base;
	return [...base, '-loop', '0', '-t', String(MAX_DURATION), '-preset', 'default', '-an', '-vsync', '0'];
}

async function ffmpegSticker(buffer, ext, isVideo) {
	const id = randomBytes(6).toString('hex');
	const input = join(tmpdir(), `stk-${id}.${ext}`);
	const output = join(tmpdir(), `stk-${id}.webp`);
	await writeFile(input, buffer);
	try {
		await run(['ffmpeg', '-y', '-i', input, ...ffArgs(isVideo), output]);
		return await readFile(output);
	} finally {
		await unlink(input).catch(() => {});
		await unlink(output).catch(() => {});
	}
}

export function buildExif(pack, author) {
	const json = {
		'sticker-pack-id': `corvaith-${Date.now()}`,
		'sticker-pack-name': pack,
		'sticker-pack-publisher': author,
		emojis: ['\u{1F60B}', '\u{1F60E}', '\u{1F923}', '\u{1F602}', '\u{1F601}'],
		'is-avatar-sticker': 0,
	};
	const exifAttr = Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00]);
	const jsonBuff = Buffer.from(JSON.stringify(json), 'utf-8');
	const exif = Buffer.concat([exifAttr, jsonBuff]);
	exif.writeUIntLE(jsonBuff.length, 14, 4);
	return exif;
}

export function isAnimated(buffer, mime) {
	if (/^video\//.test(mime)) return true;
	if (mime === 'image/gif') return true;
	if (mime === 'image/webp') return Boolean(buffer && buffer.length > 12 && buffer.toString('latin1', 0, 4) === 'RIFF' && buffer.includes(Buffer.from('ANIM')));
	return false;
}

/**
 * Convert any media buffer to a WhatsApp sticker. WebP input is never
 * re-encoded (native framing preserved); images/videos go through the
 * ChiiMD ffmpeg filter. EXIF is muxed with node-webpmux.
 */
export async function createSticker(buffer, options = {}) {
	const { pack = 'whatsapp-bot', author = 'WhatsApp Bot', animated } = options;
	const type = await fileTypeFromBuffer(buffer).catch(() => null);
	const mime = type?.mime || '';
	const isAnim = animated ?? isAnimated(buffer, mime);

	let webpBuf;
	if (mime === 'image/webp') {
		webpBuf = buffer; // no re-encode: keep exact dimensions/framing
	} else {
		const ext = type?.ext || (isAnim ? 'mp4' : 'png');
		webpBuf = await ffmpegSticker(buffer, ext, isAnim);
	}

	const img = new webp.Image();
	await img.load(webpBuf);
	img.exif = buildExif(pack, author);
	const out = await img.save(null);
	// node-webpmux does not always set the ALPH flag even when frames carry alpha;
	// without it some clients render the padding opaque. Patch the flag byte.
	if (out.toString('ascii', 12, 16) === 'VP8X') out[20] |= 0x10;
	if (out.length > MAX_STICKER_BYTES) {
		// animated + over 1 MB: re-encode at lower fps/quality
		if (isAnim && mime !== 'image/webp') {
			const retry = await ffmpegSticker(buffer, type?.ext || 'mp4', true);
			const img2 = new webp.Image();
			await img2.load(retry);
			img2.exif = buildExif(pack, author);
			const out2 = await img2.save(null);
			if (out2.toString('ascii', 12, 16) === 'VP8X') out2[20] |= 0x10;
			return out2;
		}
	}
	return out;
}

/** Attach pack EXIF to an already-sticker-ready WebP buffer (no conversion). */
export async function writeExifWebp(webpBuf, options = {}) {
	const { pack = 'whatsapp-bot', author = 'WhatsApp Bot' } = options;
	const img = new webp.Image();
	await img.load(webpBuf);
	img.exif = buildExif(pack, author);
	const out = await img.save(null);
	if (out.toString('ascii', 12, 16) === 'VP8X') out[20] |= 0x10;
	return out;
}
