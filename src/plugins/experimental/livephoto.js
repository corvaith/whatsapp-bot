/**
 * Send a WhatsApp Live Photo (motion photo): paired image + short video.
 * Easiest flow: attach a video with .livephoto as its caption.
 */
import { execFile } from 'child_process';
import { generateWAMessageFromContent, prepareWAMessageMedia, proto } from 'baileys';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

export default {
	commands: ['livephoto'],
	category: 'experimental',
	description: 'Turn a short video into a live photo. Attach the video with .livephoto as caption (or reply to one).',
	usage: '{prefix}livephoto (attach a video with this as caption, or reply to a video)',
	react: '🖼️',

	async run(context) {
		const { m, conn, quoted, downloadMedia } = context;
		const source = m.isQuoted ? m.quoted : m;
		const mime = source?.msg?.mimetype || '';
		if (!source?.isMedia || !mime.startsWith('video/')) {
			return m.reply(
				`How to use:\n1. Attach a short video (≤6s)\n2. Put ${m.prefix}livephoto as the caption\n\nOr reply to an existing video with ${m.prefix}livephoto.`,
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
				imageBuffer = videoBuffer; // fallback should not normally happen
			}

			const { imageMessage } = await prepareWAMessageMedia({ image: imageBuffer }, { upload: conn.waUploadToServer });
			const { videoMessage } = await prepareWAMessageMedia({ video: videoBuffer }, { upload: conn.waUploadToServer });

			const parent = generateWAMessageFromContent(
				m.chat,
				{ imageMessage: { ...imageMessage, contextInfo: { pairedMediaType: proto.ContextInfo.PairedMediaType.MOTION_PHOTO_PARENT, statusSourceType: 0 } } },
				{},
			);
			await conn.relayMessage(m.chat, parent.message, { messageId: parent.key.id });

			const child = proto.Message.create({
				videoMessage: { ...videoMessage, contextInfo: { pairedMediaType: proto.ContextInfo.PairedMediaType.MOTION_PHOTO_CHILD, statusSourceType: 0 } },
				messageContextInfo: {
					messageAssociation: {
						associationType: proto.MessageAssociation.AssociationType.MOTION_PHOTO,
						parentMessageKey: parent.key,
					},
				},
			});
			await conn.relayMessage(m.chat, child, { messageId: `${parent.key.id}MOTION` });
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	},
};
