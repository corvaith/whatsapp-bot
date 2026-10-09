/** Send a WhatsApp catalog product card. */
import { randomBytes } from 'crypto';
import { prepareWAMessageMedia, generateMessageIDV2, proto } from 'baileys';
import { toLid } from '#services/usersJid.js';
import { resolveMedia, BANNER_IMAGE } from './assets.js';

export default {
	commands: ['catalog'],
	category: 'experimental',
	description: 'Send a product catalog card. Bare command uses the default photo; attach/reply an image to override.',
	usage: '{prefix}catalog <title>',
	react: '\u{1F6CD}\uFE0F',

	async run(context) {
		const { m, conn, text } = context;
		const title = (text || '').trim() || 'My Product';

		const media = await resolveMedia(m, BANNER_IMAGE);
		if (!media) {
			await m.react('❌');
			return m.reply('Could not load the product photo. Attach or reply an image, or try again.');
		}
		const imgBuf = media.buffer;

		const { imageMessage } = await prepareWAMessageMedia({ image: imgBuf }, { upload: conn.waUploadToServer });

		const productId = `300${randomBytes(7).toString('hex')}`.slice(0, 17);
		await conn.relayMessage(
			m.chat,
			{
				productMessage: proto.Message.ProductMessage.create({
					product: {
						productImage: imageMessage,
						productId,
						title,
						productImageCount: 1,
					},
					businessOwnerJid: toLid(m.sender),
					contextInfo: {
						expiration: 7776000,
						disappearingMode: { initiator: 0, trigger: 1, initiatedByMe: false },
					},
				}),
				messageContextInfo: {
					messageSecret: randomBytes(32),
				},
			},
			{ messageId: generateMessageIDV2(conn.user?.id) },
		);
	},
};
