/**
 * Send a WhatsApp Live Photo (motion photo): paired image + short video,
 * recipe matched against elynn-baileys generateWAMotionPhotoMessages.
 */
import { execFile } from 'child_process';
import { generateMessageIDV2, prepareWAMessageMedia, proto } from 'baileys';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

export default {
	commands: ['livephoto'],
	category: 'experimental',
	description: 'Turn a short video into a live photo. Attach the video with .livephoto as caption (or reply to one).',
	usage: '{prefix}livephoto (attach a video with this as caption, or reply to a video)',
	react: '\u{1F5BC}\uFE0F',

	async run(context) {
		const { m, conn, downloadMedia } = context;
		const source = m.isQuoted ? m.quoted : m;
		const mime = source?.msg?.mimetype || '';
		if (!source?.isMedia || !mime.startsWith('video/')) {
			return m.reply(
				`How to use:\n1. Attach a short video (\u22646s)\n2. Put ${m.prefix}livephoto as the caption\n\nOr reply to an existing video with ${m.prefix}livephoto.`,
			);
		}
		const videoBuffer = await downloadMedia();

		// still frame = first frame of the video
		const dir = await mkdtemp(join(tmpdir(), 'livephoto-'));
		try {
			const frame = join(dir, 'still.jpg');
			const input = join(dir, 'input');
			await writeFile(input, videoBuffer);
			await new Promise((resolve, reject) => {
				execFile('ffmpeg', ['-y', '-i', input, '-frames:v', '1', '-q:v', '2', frame], { timeout: 30000 }, (err) => (err ? reject(err) : resolve()));
			}).catch(() => {});
			let imageBuffer;
			try {
				imageBuffer = await readFile(frame);
			} catch {
				imageBuffer = videoBuffer;
			}

			// video metadata: seconds/width/height help clients treat the child as motion
			const probe = await new Promise((resolve) => {
				execFile('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,duration', '-of', 'json', input], { timeout: 15000 }, (err, stdout) => resolve(err ? null : stdout));
			});
			let seconds;
			let width;
			let height;
			try {
				const info = JSON.parse(probe).streams?.[0] || {};
				seconds = Math.max(1, Math.round(Number(info.duration) || 1));
				width = info.width;
				height = info.height;
			} catch {
				seconds = undefined;
			}

			const { imageMessage } = await prepareWAMessageMedia({ image: imageBuffer }, { upload: conn.waUploadToServer });
			const { videoMessage } = await prepareWAMessageMedia(
				{ video: videoBuffer, ...(seconds ? { seconds } : {}), ...(width ? { width, height } : {}), ...(imageMessage.jpegThumbnail ? { jpegThumbnail: imageMessage.jpegThumbnail } : {}) },
				{ upload: conn.waUploadToServer },
			);

			const parent = {
				imageMessage: {
					...imageMessage,
					contextInfo: { pairedMediaType: proto.ContextInfo.PairedMediaType.MOTION_PHOTO_PARENT },
				},
			};
			const parentKey = { remoteJid: m.chat, fromMe: true, id: generateMessageIDV2(conn.user?.id) };
			await conn.relayMessage(m.chat, parent, { messageId: parentKey.id });

			// reference implementation relays the child after a 250ms gap
			await delay(250);

			const child = {
				videoMessage: {
					...videoMessage,
					motionPhotoPresentationOffsetMs: 350,
					contextInfo: { pairedMediaType: proto.ContextInfo.PairedMediaType.MOTION_PHOTO_CHILD },
				},
				messageContextInfo: {
					messageAssociation: {
						associationType: proto.MessageAssociation.AssociationType.MOTION_PHOTO,
						parentMessageKey: parentKey,
					},
				},
			};
			await conn.relayMessage(m.chat, child, { messageId: generateMessageIDV2(conn.user?.id) });
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	},
};
