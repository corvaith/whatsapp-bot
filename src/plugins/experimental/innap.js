/**
 * .innap — relay a hand-crafted native-flow interactive message whose content
 * also carries a sender-key distribution blob (verbatim from a working relay).
 */

// Serialized SenderKeyDistributionMessage. Must stay a binary field: protobuf
// `bytes` rejects the numeric-key object form the payload was dumped as.
const SENDER_KEY_BYTES = Uint8Array.from([
	51, 8, 218, 232, 141, 249, 7, 16, 7, 26, 32, 19, 239, 40, 201, 25, 239, 10, 132, 20, 1, 62, 11, 136, 190, 63,
	198, 76, 165, 56, 58, 123, 119, 180, 110, 138, 105, 180, 141, 81, 212, 235, 86, 34, 33, 5, 125, 79, 176, 6, 62,
	37, 125, 58, 100, 247, 47, 228, 32, 17, 41, 184, 117, 68, 234, 67, 120, 213, 5, 61, 150, 167, 7, 93, 142, 94,
	174, 40,
]);

const json = (o) => JSON.stringify(o);

export default {
	commands: ['innap'],
	category: 'experimental',
	description: 'Relay a hand-crafted native-flow interactive message.',
	usage: '{prefix}innap',

	async run({ m, conn }) {
		await conn.relayMessage(
			m.chat,
			{
				senderKeyDistributionMessage: {
					groupId: '120363423077197619@g.us',
					axolotlSenderKeyDistributionMessage: SENDER_KEY_BYTES,
				},
				interactiveMessage: {
					header: { title: 'Hello World!', hasMediaAttachment: false },
					body: { text: 'Hello World!' },
					contextInfo: {
						participant: '13135550002@s.whatsapp.net',
						remoteJid: 'status@broadcast',
					},
					nativeFlowMessage: {
						buttons: [{ name: 'inapp_signup', buttonParamsJson: json({}) }],
					},
				},
			},
			{
				additionalNodes: [
					{
						tag: 'biz',
						attrs: {},
						content: [
							{
								tag: 'interactive',
								attrs: { type: 'native_flow', v: '1' },
								content: [{ tag: 'native_flow', attrs: { v: '9', name: 'mixed' } }],
							},
						],
					},
				],
			},
		);
	},
};
