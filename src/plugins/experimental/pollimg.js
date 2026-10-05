import crypto from 'crypto';

import { generateWAMessageFromContent, prepareWAMessageMedia, proto } from 'baileys';

/**
 * Send an image poll: a poll whose options carry thumbnail images.
 */
export default {
	commands: ['pollimg'],
	category: 'experimental',
	description: 'Send a poll with image options.',
	usage: '{prefix}pollimg (reply to 2+ images or attach with caption)',

	async run(context) {
		const { m, quoted, conn, text, downloadMedia } = context;
		const source = m.isQuoted ? m.quoted : m;
		if (!source?.isMedia) {
			return m.reply('Send or reply to an image with .pollimg (one image per option for now).');
		}

		const buffer = await downloadMedia();
		const name = (text || '').trim() || 'Option 1';

		const { imageMessage } = await prepareWAMessageMedia({ image: buffer }, { upload: conn.waUploadToServer });
		if (!imageMessage?.fileSha256) throw new Error('Failed to prepare poll option image');

		const optionHash = crypto
			.createHash('sha256')
			.update(crypto.createHash('sha256').update(String(name)).digest('hex') + Buffer.from(imageMessage.fileSha256).toString('base64'))
			.digest('hex');

		const messageSecret = crypto.randomBytes(32);
		const parent = generateWAMessageFromContent(
			m.chat,
			{
				pollCreationMessageV3: {
					name: 'Image poll',
					selectableOptionsCount: 1,
					options: [{ optionName: String(name), optionHash }],
					pollContentType: proto.Message.PollContentType.IMAGE,
				},
				messageContextInfo: { messageSecret },
			},
			{},
		);

		const parentKey = parent.key;
		await conn.relayMessage(m.chat, parent.message, {
			messageId: parentKey.id,
			additionalNodes: [{ tag: 'meta', attrs: { polltype: 'creation', contenttype: 'image' } }],
		});

		const child = proto.Message.create({
			messageContextInfo: {
				messageAssociation: {
					parentMessageKey: parentKey,
					associationType: proto.MessageAssociation.AssociationType.MEDIA_POLL,
				},
			},
			pollCreationOptionImageMessage: { message: { imageMessage } },
		});

		await conn.relayMessage(m.chat, child, {
			messageId: crypto.randomUUID(),
			additionalNodes: [{ tag: 'meta', attrs: { message_association_type: 'media_poll' } }],
		});
	},
};
