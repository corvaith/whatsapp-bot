/**
 * Post a group story (groupStatusMessageV2): text, image, video, or audio.
 * Audio is converted to opus ptt so it can be played from the story.
 */
import crypto from 'crypto';
import { execFile } from 'child_process';
import { generateWAMessageContent, generateWAMessageFromContent, proto } from 'baileys';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

export default {
	commands: ['grupstory', 'gstory'],
	category: 'experimental',
	description: 'Post a story visible only in this group. Attach media with caption, or .grupstory <text>.',
	usage: '{prefix}grupstory <text> | (attach image/video/audio with this as caption)',
	react: 'story',

	async run(context) {
		const { m, conn, quoted, text, downloadMedia } = context;
		const source = m.isQuoted ? m.quoted : m;
		const mime = source?.msg?.mimetype || '';

		let content;
		if (source?.isMedia && mime.startsWith('audio/')) {
			const buffer = await downloadMedia();
			const dir = await mkdtemp(join(tmpdir(), 'gstory-'));
			try {
				const input = join(dir, 'in');
				const output = join(dir, 'out.ogg');
				await writeFile(input, buffer);
				await new Promise((resolve, reject) => {
					execFile('ffmpeg', ['-y', '-i', input, '-avoid_negative_ts', 'make_zero', '-ac', '1', '-c:a', 'libopus', output], { timeout: 60000 }, (err) => (err ? reject(err) : resolve()));
				});
				content = { audio: await readFile(output), mimetype: 'audio/ogg; codecs=opus', ptt: true };
			} finally {
				await rm(dir, { recursive: true, force: true });
			}
		} else if (source?.isMedia && mime.startsWith('video/')) {
			content = { video: await downloadMedia(), caption: (text || '').trim() || undefined };
		} else if (source?.isMedia && mime.startsWith('image/')) {
			content = { image: await downloadMedia(), caption: (text || '').trim() || undefined };
		} else if (text && text.trim()) {
			content = { text: text.trim() };
		} else {
			return m.reply(
				`How to use:\n- ${m.prefix}grupstory <text> for a text story\n- Attach an image/video/audio with ${m.prefix}grupstory as caption (or reply to one)\n- Audio is auto-converted to voice note so it can be played`,
			);
		}

		const inner = await generateWAMessageContent(content, { upload: conn.waUploadToServer });
		const messageSecret = crypto.randomBytes(32);
		const wrapped = generateWAMessageFromContent(
			m.chat,
			{
				messageContextInfo: { messageSecret },
				groupStatusMessageV2: { message: { ...inner, messageContextInfo: { messageSecret } } },
			},
			{ userJid: conn.user.id },
		);
		await conn.relayMessage(m.chat, wrapped.message, { messageId: wrapped.key.id });
	},
};
