/**
 * Send a self-destructing message (view-once style custom ephemeral).
 */
export default {
	commands: ['vanish'],
	category: 'experimental',
	description: 'Send a message that disappears after N seconds.',
	usage: '{prefix}vanish <seconds> <text>',

	async run(context) {
		const { m, conn, text } = context;
		const [secondsRaw, ...rest] = (text || '').split(' ');
		const seconds = Math.min(Math.max(parseInt(secondsRaw, 10) || 5, 1), 60);
		const message = rest.join(' ');
		if (!message) return m.reply(`Usage: ${m.prefix}vanish <seconds> <text>`);

		await conn.relayMessage(
			m.chat,
			{
				extendedTextMessage: {
					text: message,
					previewType: 0,
					contextInfo: {
						expiration: 0,
						ephemeralSettingTimestamp: Date.now(),
						disappearingMode: { initiator: 0, trigger: 1 },
						afterReadDuration: seconds,
					},
					inviteLinkGroupTypeV2: 0,
				},
			},
			{},
		);
	},
};
