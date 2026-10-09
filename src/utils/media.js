import { randomBytes } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, rm, unlink, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileTypeFromBuffer } from 'file-type';
import webp from 'node-webpmux';

const SIZE = 320;
const MAX_DURATION = 10;
const MAX_STICKER_BYTES = 1024 * 1024;

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
		webpBuf = buffer;
	} else {
		const ext = type?.ext || (isAnim ? 'mp4' : 'png');
		webpBuf = await ffmpegSticker(buffer, ext, isAnim);
	}

	const img = new webp.Image();
	await img.load(webpBuf);
	img.exif = buildExif(pack, author);
	const out = await img.save(null);
	if (out.toString('ascii', 12, 16) === 'VP8X') out[20] |= 0x10;
	if (out.length > MAX_STICKER_BYTES) {
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

/**
 * Audio analysis via ffmpeg for voice notes: 64-bucket waveform (0-100) and
 * duration. The fork's built-in extractor needs the audio-decode peer (not
 * installed) and returns undefined, so ptt computes these itself.
 */

const SAMPLES = 64;

/** Parse "HH:MM:SS.ms" from ffmpeg output into whole seconds. */
const durationSeconds = (stderr) => {
	const match = /Duration: (\d+):(\d+):(\d+)(?:\.(\d+))?/.exec(stderr);
	if (!match) return undefined;
	const [, h, m, s, ms = '0'] = match;
	return Math.round(Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(`0.${ms}`));
};

export async function analyzeAudio(buffer) {
	const dir = await mkdtemp(join(tmpdir(), 'wave-'));
	const input = join(dir, 'in');
	const pcm = join(dir, 'out.pcm');
	try {
		await writeFile(input, buffer);
		let duration;
		await new Promise((resolve, reject) => {
			execFile('ffmpeg', ['-i', input, '-ac', '1', '-ar', '8000', '-f', 's16le', '-acodec', 'pcm_s16le', '-y', pcm], { timeout: 60_000 }, (err, _stdout, stderr) => {
				if (err) return reject(err);
				duration = durationSeconds(stderr);
				resolve();
			});
		});
		const raw = await readFile(pcm);
		const n = raw.length >> 1;
		const block = Math.max(1, Math.floor(n / SAMPLES));
		const buckets = new Array(SAMPLES).fill(0);
		let peak = 0;
		for (let i = 0; i < SAMPLES; i++) {
			let sum = 0;
			let count = 0;
			for (let j = i * block; j < Math.min((i + 1) * block, n); j++) {
				sum += Math.abs(raw.readInt16LE(j * 2));
				count++;
			}
			buckets[i] = count ? sum / count : 0;
			if (buckets[i] > peak) peak = buckets[i];
		}
		const scale = peak > 0 ? 100 / peak : 0;
		const waveform = new Uint8Array(buckets.map((b) => Math.min(100, Math.floor(b * scale))));
		return { waveform, seconds: duration };
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

/**
 * PTT (voice note) Opus repacketization for iOS playback.
 *
 * WhatsApp's native voice notes pack several 20ms SILK frames per Opus packet
 * (TOC "code 3", e.g. 3x20ms = 60ms). libopus/ffmpeg emit one frame per packet
 * ("code 0"). iOS WhatsApp rejects code-0 PTT ("this audio is no longer
 * available, ask the sender to resend it"); Android tolerates it. Regrouping
 * the code-0 frames into code-3 packets makes voice notes play on iOS.
 *
 * Ported from WhiskeySockets/Baileys PR #2648 (repacketizeOggOpusToCode3) so
 * this fork keeps its zero-peer-dependency ffmpeg-only pipeline.
 */

const OGG_CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let i = 0; i < 256; i++) {
		let r = (i << 24) >>> 0;
		for (let j = 0; j < 8; j++) {
			r = r & 0x80000000 ? ((r << 1) ^ 0x04c11db7) >>> 0 : (r << 1) >>> 0;
		}
		table[i] = r >>> 0;
	}
	return table;
})();

const oggPageCrc = (page) => {
	let crc = 0;
	for (let i = 0; i < page.length; i++) {
		crc = (((crc << 8) >>> 0) ^ OGG_CRC_TABLE[((crc >>> 24) & 0xff) ^ page[i]]) >>> 0;
	}
	return crc >>> 0;
};

const opusFrameSamples48k = (config) => {
	const c = config & 0x1f;
	const ms = c < 12 ? [10, 20, 40, 60][c % 4] : c < 16 ? (c % 2 === 0 ? 10 : 20) : [2.5, 5, 10, 20][c % 4];
	return Math.round(ms * 48);
};

const parseOggPackets = (buf) => {
	const packets = [];
	let cur = [];
	let off = 0;
	let serial = 0;
	let preSkip = 0;
	while (off + 27 <= buf.length) {
		if (buf.toString('ascii', off, off + 4) !== 'OggS') break;
		serial = buf.readUInt32LE(off + 14);
		const nseg = buf[off + 26];
		const segTableStart = off + 27;
		let dataOff = segTableStart + nseg;
		for (let s = 0; s < nseg; s++) {
			const len = buf[segTableStart + s];
			cur.push(buf.subarray(dataOff, dataOff + len));
			dataOff += len;
			if (len < 255) {
				packets.push(Buffer.concat(cur));
				cur = [];
			}
		}
		off = dataOff;
	}
	if (cur.length) packets.push(Buffer.concat(cur));
	if ((packets[0]?.length ?? 0) >= 12 && packets[0].subarray(0, 8).toString('ascii') === 'OpusHead') {
		preSkip = packets[0].readUInt16LE(10);
	}
	return { packets, serial, preSkip };
};

const encodeOpusFrameLength = (len) => {
	if (len < 252) return [len];
	const b0 = 252 + (len % 4);
	return [b0, Math.floor((len - b0) / 4)];
};

const buildOggPage = (headerType, granule, serial, seq, packet) => {
	const segs = [];
	let rem = packet.length;
	while (rem >= 255) {
		segs.push(255);
		rem -= 255;
	}
	segs.push(rem);
	const header = Buffer.alloc(27 + segs.length);
	header.write('OggS', 0, 'ascii');
	header[4] = 0;
	header[5] = headerType;
	header.writeBigUInt64LE(BigInt(granule), 6);
	header.writeUInt32LE(serial >>> 0, 14);
	header.writeUInt32LE(seq >>> 0, 18);
	header[26] = segs.length;
	for (let i = 0; i < segs.length; i++) {
		header[27 + i] = segs[i];
	}
	const page = Buffer.concat([header, packet]);
	page.writeUInt32LE(oggPageCrc(page), 22);
	return page;
};

/**
 * Regroups single-frame ("code 0") Opus packets of an OGG/Opus stream into
 * multi-frame ("code 3") packets (default 3x20ms = 60ms), matching the
 * packetization WhatsApp's native client uses for voice notes so they play on
 * iOS. Returns the input untouched if it is not OGG/Opus or is already code 3.
 */
export const repacketizeOggOpusToCode3 = (input, framesPerPacket = 3) => {
	if (!Number.isInteger(framesPerPacket) || framesPerPacket < 1 || framesPerPacket > 48) {
		throw new Error('framesPerPacket must be an integer between 1 and 48');
	}
	if (!Buffer.isBuffer(input) || input.length < 4 || input.toString('ascii', 0, 4) !== 'OggS') {
		return input;
	}

	const { packets, serial, preSkip } = parseOggPackets(input);
	if (packets.length < 3 || packets[0].subarray(0, 8).toString('ascii') !== 'OpusHead') {
		return input;
	}

	const audioPackets = packets.slice(2);
	if (!audioPackets.length || audioPackets.some((p) => p.length < 1 || (p[0] & 0x03) !== 0)) {
		return input;
	}

	const frames = audioPackets.map((p) => ({
		configStereo: p[0] >> 2,
		samples: opusFrameSamples48k(p[0] >> 3),
		data: p.subarray(1),
	}));

	const out = [buildOggPage(0x02, 0, serial, 0, packets[0]), buildOggPage(0x00, 0, serial, 1, packets[1])];
	let seq = 2;
	let samplesDone = 0;
	let i = 0;
	while (i < frames.length) {
		const cs = frames[i].configStereo;
		const group = [];
		while (i < frames.length && group.length < framesPerPacket && frames[i].configStereo === cs) {
			group.push(frames[i].data);
			samplesDone += frames[i].samples;
			i++;
		}

		const toc = ((cs << 2) | 3) & 0xff;
		const frameCountByte = (0x80 | group.length) & 0xff;
		const lengths = [];
		for (let k = 0; k < group.length - 1; k++) {
			lengths.push(...encodeOpusFrameLength(group[k].length));
		}

		const packet = Buffer.concat([Buffer.from([toc, frameCountByte, ...lengths]), ...group]);
		out.push(buildOggPage(i >= frames.length ? 0x04 : 0x00, preSkip + samplesDone, serial, seq, packet));
		seq++;
	}

	return Buffer.concat(out);
};
