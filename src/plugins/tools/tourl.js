import { upload, providers } from '#services/uploader.js';
import { getMediaBuffer } from '../media/mediaHelpers.js';
const URL_RE = /https?:\/\/[^\s<>"')\]]+/i;

const HELP = (prefix) =>
	`*${prefix}tourl [provider]* — upload media, get a link\n\n` + `Reply to media or send media with this caption.\nProviders: ${Object.keys(providers).join(', ')} (default uguu).`;

export default {
	commands: ['tourl', 'upload'],
	category: 'tools',
	description: 'Upload media to a file host and get a direct URL.',
	usage: '{prefix}tourl [provider] (reply or send media)',
	react: '🔗',

	async run({ m, args, prefix }) {
		const provider = args[0]?.toLowerCase();
		if (provider && !providers[provider]) return m.reply(HELP(prefix));

		const source = await getMediaBuffer(m);
		if (!source) return m.reply(HELP(prefix));
		if (source.buffer.length > 100 * 1024 * 1024) return m.reply('Media is too large (max 100 MB).');

		try {
			const url = await upload(source.buffer, undefined, provider);
			await m.react('✅');
			await m.reply(`*Upload success* ✅\nProvider: ${provider || 'uguu'}\nSize: ${(source.buffer.length / 1024).toFixed(1)} KB\n\n${url}`);
		} catch (err) {
			await m.react('❌');
			await m.reply(`Upload failed: ${err.message?.slice(0, 200) || 'unexpected error.'}`);
		}
	},
};
