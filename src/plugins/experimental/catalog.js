/**
 * .catalog — productMessage card (WhatsApp catalog product), wire shape from
 * a working hand-relayed payload.
 */
import { randomBytes } from 'crypto';
import { prepareWAMessageMedia, generateMessageIDV2, proto } from 'baileys';

export default {
	commands: ['catalog'],
	category: 'experimental',
	description: 'Send a product catalog card. Attach/reply an image: .catalog <title>',
	usage: '{prefix}catalog MY WAIFU 1',
	react: '\u{1F6CD}\uFE0F',

	async run(context) {
		const { m, conn, text } = context;
		const title = (text || '').trim() || 'My Product';

		let imgBuf;
		if (m.isQuoted && m.quoted.isMedia) imgBuf = await m.quoted.download();
		else if (m.isMedia) imgBuf = await m.download();
		if (!imgBuf) {
			await m.react('❌');
			return m.reply('Attach or reply an image for the product photo.\nUsage: .catalog <title>');
		}

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
					businessOwnerJid: m.sender.replace('@s.whatsapp.net', '@lid'),
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
