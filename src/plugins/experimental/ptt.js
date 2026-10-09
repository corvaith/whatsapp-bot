/**
 * Send a voice note (ptt) — converts any audio/video input to opus ogg with a
 * rendered waveform and explicit duration (iPhone shows both correctly).
 */
import { execFile } from 'child_process';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { analyzeAudio } from '#utils/media.js';
import { repacketizeOggOpusToCode3 } from '#utils/media.js';

export default {
	commands: ['ptt'],
	category: 'experimental',
	description: 'Send audio as a WhatsApp voice note (push to talk).',
	usage: '{prefix}ptt (reply to audio/video or attach with caption)',
	react: '🎙️',

	async run(context) {
		const { m, quoted, downloadMedia, conn } = context;
		const source = m.isQuoted ? m.quoted : m;
		if (!source?.isMedia) return m.reply('Send or reply to an audio/video with .ptt');

		const buffer = await downloadMedia();
		const dir = await mkdtemp(join(tmpdir(), 'ptt-'));
		const input = join(dir, 'input');
		const output = join(dir, 'out.ogg');
		try {
			await writeFile(input, buffer);
			await new Promise((resolve, reject) => {
				execFile('ffmpeg', ['-y', '-i', input, '-avoid_negative_ts', 'make_zero', '-ac', '1', '-c:a', 'libopus', output], { timeout: 60000 }, (err) => (err ? reject(err) : resolve()));
			});
			const ogg = await readFile(output);
			const playable = repacketizeOggOpusToCode3(ogg);
			const { waveform, seconds } = await analyzeAudio(playable);
			await m.reply(
				{ audio: playable, mimetype: 'audio/ogg; codecs=opus', ptt: true },
				{
					processMedia: async (buf, mediaType, waClient) => ({
						upload: waClient ? await waClient.uploadMedia(buf, mediaType) : await conn.waUploadToServer(buf, { mediaType }),
						metadata: { waveform, seconds },
					}),
				},
			);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	},
};
