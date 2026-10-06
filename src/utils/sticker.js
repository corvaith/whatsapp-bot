import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { unlink, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileTypeFromBuffer } from 'file-type';

const SIZE = 320;
const MAX_DURATION = 10;
const MAX_STICKER_BYTES = 1024 * 1024;

const vf = (fps) =>
	[
		`scale=${SIZE}:${SIZE}:force_original_aspect_ratio=decrease`,
		`fps=${fps}`,
		`pad=${SIZE}:${SIZE}:-1:-1:color=white@0.0`,
		'split[a][b]',
		'[a]palettegen=reserve_transparent=on:transparency_color=ffffff[p]',
		'[b][p]paletteuse',
	].join(',');

const IMAGE_EXT = { jpg: 'jpg', jpeg: 'jpg', png: 'png', webp: 'webp', gif: 'gif', bmp: 'bmp' };
const VIDEO_EXT = { mp4: 'mp4', webm: 'webm', mkv: 'mkv', avi: 'avi', mov: 'mov' };

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

export function buildExif(pack, author) {
	const data = Buffer.from(
		JSON.stringify({
			'sticker-pack-id': 'com.bot.sticker',
			'sticker-pack-name': pack,
			'sticker-pack-publisher': author,
			emojis: ['❤️'],
			'is-avatar-sticker': 0,
		}),
		'utf8',
	);
	const exif = Buffer.concat([Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00]), data]);
	exif.writeUIntLE(data.length, 14, 4);
	return exif;
}

export function injectExif(webp, exif) {
	if (webp.toString('ascii', 0, 4) !== 'RIFF' || webp.toString('ascii', 8, 12) !== 'WEBP') {
		throw new Error('Not a WebP buffer.');
	}
	const body = webp.subarray(12);
	const chunks = [];
	let off = 0;
	while (off + 8 <= body.length) {
		const fourcc = body.toString('ascii', off, off + 4);
		const size = body.readUInt32LE(off + 4);
		const total = 8 + size + (size % 2);
		if (fourcc !== 'EXIF') chunks.push(body.subarray(off, off + total));
		off += total;
	}
	const pad = exif.length % 2 ? Buffer.from([0]) : Buffer.alloc(0);
	const head = Buffer.alloc(8);
	head.write('EXIF', 0, 'ascii');
	head.writeUInt32LE(exif.length, 4);
	const exifChunk = Buffer.concat([head, exif, pad]);
	const vp8xIndex = chunks.findIndex((c) => c.toString('ascii', 0, 4) === 'VP8X');
	if (vp8xIndex > 0) chunks.unshift(...chunks.splice(vp8xIndex, 1));
	chunks.push(exifChunk);
	const payload = Buffer.concat(chunks);
	const out = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), payload]);
	out.writeUInt32LE(out.length - 8, 4);
	return out;
}

const PILLOW = `import base64, io, sys
from PIL import Image
im = Image.open(io.BytesIO(base64.b64decode(sys.stdin.read())))
frames = []
durations = []
for i in range(getattr(im, "n_frames", 1)):
    im.seek(i)
    fr = im.convert("RGBA")
    w, h = fr.size
    scale = min(512 / w, 512 / h, 1)
    if scale < 1:
        fr = fr.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.LANCZOS)
    canvas = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
    canvas.paste(fr, ((512 - fr.width) // 2, (512 - fr.height) // 2), fr)
    durations.append(min(im.info.get("duration", 100), 10000) // 10)
    frames.append(canvas)
out = io.BytesIO()
kw = dict(save_all=len(frames) > 1, duration=durations, loop=0, quality=90, method=4)
if len(frames) > 1:
    kw["append_images"] = frames[1:]
frames[0].save(out, "WEBP", **kw)
sys.stdout.buffer.write(out.getvalue())
`;

export function isAnimated(buffer, mime) {
	if (/^video\//.test(mime)) return true;
	if (mime === 'image/gif') return true;
	if (mime === 'image/webp') return Boolean(buffer && buffer.length > 12 && buffer.toString('latin1', 0, 4) === 'RIFF' && buffer.includes(Buffer.from('ANIM')));
	return false;
}

async function ffmpegSticker(buffer, ext, isAnim) {
	const id = randomUUID();
	const input = join(tmpdir(), `sticker-${id}.${ext}`);
	const output = join(tmpdir(), `sticker-${id}-out.webp`);
	await writeFile(input, buffer);
	try {
		const base = ['ffmpeg', '-y', '-i', input, '-vcodec', 'libwebp', '-preset', 'default', '-an'];
		if (isAnim) {
			const attempts = [
				['-lavfi', vf(15), '-loop', '0', '-t', String(MAX_DURATION), '-quality', '75', '-vsync', '0'],
				['-lavfi', vf(10), '-loop', '0', '-t', String(MAX_DURATION), '-quality', '50', '-vsync', '0'],
				['-lavfi', vf(8), '-loop', '0', '-t', '6', '-quality', '35', '-vsync', '0'],
				['-lavfi', vf(5), '-loop', '0', '-t', '5', '-quality', '25', '-vsync', '0'],
			];
			for (const tail of attempts) {
				const args = [...base, ...tail, output];
				await run(args);
				const webp = await readFile(output);
				if (webp.length <= MAX_STICKER_BYTES) return webp;
			}
			return await readFile(output);
		}
		await run([...base, '-lavfi', vf(15), '-frames:v', '1', '-quality', '80', output]);
		return await readFile(output);
	} finally {
		await unlink(input).catch(() => {});
		await unlink(output).catch(() => {});
	}
}

export async function createSticker(buffer, options = {}) {
	const { pack = 'Katsumi Style', author = 'WhatsApp Bot', animated } = options;
	const type = await fileTypeFromBuffer(buffer).catch(() => null);
	const mime = type?.mime || '';
	const isAnim = animated ?? isAnimated(buffer, mime);

	let webp;
	if (mime === 'image/webp') {
		webp = await run(['python3', '-c', PILLOW], buffer.toString('base64'));
	} else {
		const ext = (type?.ext && (IMAGE_EXT[type.ext] || VIDEO_EXT[type.ext])) || (isAnim ? 'mp4' : 'jpg');
		webp = await ffmpegSticker(buffer, ext, isAnim);
	}

	if (webp.toString('ascii', 0, 4) !== 'RIFF' || webp.toString('ascii', 8, 12) !== 'WEBP') {
		throw new Error('Conversion produced an invalid WebP file.');
	}
	return injectExif(webp, buildExif(pack, author));
}
