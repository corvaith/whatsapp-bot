import { fileTypeFromBuffer } from 'file-type';

const VIEW_ONCE_TYPES = ['viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension', 'documentWithCaption'];

function isQuotedViewOnce(m) {
	if (!m.quoted?.message) return false;
	return VIEW_ONCE_TYPES.some((type) => Boolean(m.quoted.message[type]));
}

/**
 * Recover view-once media as a normal media message.
 */
export default {
	commands: ['rvo'],
	category: 'media',
	description: 'Recover view-once media.',
	usage: '{prefix}rvo (reply to view-once media)',

	async run({ m, quoted, downloadMedia }) {
		if (isQuotedViewOnce(m)) throw 'Reply to a view-once message.';

		const buffer = await downloadMedia();
		const type = await fileTypeFromBuffer(buffer);

		if (type?.mime?.startsWith('video/')) return void m.reply({ video: buffer, caption: m.quoted?.msg?.caption || undefined });
		if (type?.mime?.startsWith('audio/')) return void m.reply({ audio: buffer, mimetype: type.mime });
		m.reply({ image: buffer, caption: m.quoted?.msg?.caption || undefined });
	},
};
