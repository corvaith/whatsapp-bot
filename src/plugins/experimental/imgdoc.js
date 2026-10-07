/**
 * .imgdoc — document with picture preview: jpegThumbnail + an image mimetype
 * makes some clients render the picture in the document bubble.
 */
import { getMediaBuffer } from '#plugins/media/_shared.js';

export default {
	commands: ['imgdoc'],
	category: 'experimental',
	description: 'Send an image as a document with a picture thumbnail. Reply to an image or attach one with the caption.',
	usage: '{prefix}imgdoc [caption]',
	react: '📄',

	async run(context) {
		const { m, conn, text } = context;
		const media = await getMediaBuffer(m);
		if (!media) {
			return m.reply('Send or reply to an image with .imgdoc');
		}
		const { buffer, mime } = media;

		const { execFile } = await import('child_process');
		const { promisify } = await import('util');
		const { writeFile, readFile, unlink } = await import('fs/promises');
		const { tmpdir } = await import('os');
		const { join } = await import('path');
		const execFileP = promisify(execFile);
		const tmp = join(tmpdir(), `imgdoc-${Date.now()}`);
		await writeFile(tmp, buffer);
		try {
			await execFileP('/usr/bin/ffmpeg', ['-y', '-i', tmp, '-vf', 'scale=150:150:force_original_aspect_ratio=increase,crop=150:150', '-q:v', '4', tmp + '.jpg'], { timeout: 30000 });
		} catch {
			// ffmpeg can't decode (e.g. animated webp) — fall back to the raw bytes
		}
		const thumb = await readFile(tmp + '.jpg').catch(() => buffer);
		await unlink(tmp + '.jpg').catch(() => {});
		await unlink(tmp).catch(() => {});

		await conn.sendMessage(
			m.chat,
			{
				document: buffer,
				mimetype: mime || 'image/png',
				fileName: (text || '').trim() || 'image.png',
				jpegThumbnail: thumb,
				caption: undefined,
			},
			{ quoted: m },
		);
	},
};
