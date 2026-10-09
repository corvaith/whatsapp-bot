/**
 * Send a video note (circular "bullet" message) from a video.
 */
export default {
	commands: ['ptv'],
	category: 'experimental',
	description: 'Send a video as a circular video note (ptv).',
	usage: '{prefix}ptv (reply to a video or attach with caption)',

	async run(context) {
		const { m, quoted, downloadMedia } = context;
		const source = m.isQuoted ? m.quoted : m;
		if (!source?.isMedia || !(source?.msg?.mimetype || '').startsWith('video/')) {
			return m.reply('Send or reply to a video with .ptv (mp4/webm).');
		}
		const buffer = await downloadMedia();
		await m.reply({ video: buffer, ptv: true, caption: undefined });
	},
};
