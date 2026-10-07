/**
 * .aicard — Meta AI style entity card (AIRich compact entity primitive),
 * shape taken verbatim from a working hand-relayed payload.
 */
import crypto from 'crypto';
import { generateMessageIDV2, proto } from 'baileys';

const section = (primitives, layout = 'GenAIActionRowLayoutViewModel') => ({
	view_model: { primitives, __typename: layout },
});

export default {
	commands: ['aicard'],
	category: 'experimental',
	description: 'Send a Meta AI style entity card with image, link chip and social entity text. Usage: .aicard Title | Subtitle | ImageURL | EntityURL | Text',
	usage: '{prefix}aicard Ai Lookup | By bot | https://files.catbox.moe/h87kyf.png | https://instagram.com/user | text',
	react: '🪪',

	async run(context) {
		const { m, conn, text } = context;
		const [title, subtitle, image, entityUrl, body] = (text || '').split('|').map((p) => p.trim());
		if (!title || !image || !entityUrl) {
			return m.reply(
				`Usage: ${m.prefix}aicard Title | Subtitle | ImageURL | EntityURL | [Text]\nExample: ${m.prefix}aicard Ai Lookup | By bot | https://files.catbox.moe/h87kyf.png | https://instagram.com/instagram | See results`,
			);
		}
		const username = entityUrl.replace(/\/+$/, '').split('/').pop() || title;

		const sections = [
			section([
				{
					title,
					subtitle: subtitle || '',
					secondary_subtitle: '',
					image: { url: image, mime_type: 'image/png' },
					entity_id: '123456',
					entity_url: entityUrl,
					entity_type: 'WEBSITE',
					action_type: 'OPEN_URL',
					is_verified: true,
					__typename: 'GenAICompactEntityPrimitive',
				},
			]),
			section([{ type: 'HORIZONTAL_LINE', __typename: 'GenAIDividerPrimitive' }], 'GenAIVStackLayoutViewModel'),
			section([
				{ __typename: 'GenAISpacerPrimitive' },
				{
					text: `# {{social_entity_1}}${body || 'See results'}\0{{/social_entity_1}}    `,
					inline_entities: [
						{
							key: 'social_entity_1',
							metadata: {
								__typename: 'GenAISocialEntityItem',
								entity_id: username,
								entity_name: username,
								entity_full_name: title,
								entity_picture_url: image,
								entity_url: entityUrl,
								entity_type: 'IG_PROFILE',
								is_verified: true,
							},
						},
					],
					__typename: 'GenAIMarkdownTextUXPrimitive',
				},
				{ __typename: 'GenAISpacerPrimitive' },
			]),
		];

		await conn.relayMessage(
			m.chat,
			{
				botForwardedMessage: {
					message: {
						richResponseMessage: {
							messageType: proto.AIRichResponseMessageType.AI_RICH_RESPONSE_TYPE_STANDARD,
							submessages: [],
							unifiedResponse: {
								data: Buffer.from(JSON.stringify({ response_id: crypto.randomUUID(), sections })),
							},
							contextInfo: { isForwarded: true, forwardOrigin: 4 },
						},
					},
				},
			},
			{ messageId: generateMessageIDV2(conn.user?.id) },
		);
	},
};
