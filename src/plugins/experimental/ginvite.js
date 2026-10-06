/**
 * Send a group invite card for the current group.
 */
export default {
	commands: ['ginvite'],
	category: 'experimental',
	description: 'Send a group invite card. Usage: .ginvite [caption]',
	usage: '{prefix}ginvite [caption]',
	react: '📨',

	async run(context) {
		const { m, conn, text } = context;
		if (!m.isGroup) return m.reply('Run this inside a group.');
		const code = await conn.groupInviteCode(m.chat);
		if (!code) return m.reply('Could not get the group invite code.');
		const info = await conn.groupGetInviteInfo(code).catch(() => null);
		const [years, days] = [0, 7];
		const expires = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * days;
		void years;
		await m.reply({
			groupInvite: {
				inviteCode: code,
				inviteExpiration: expires,
				text: (text || '').trim() || 'Join this group',
				jid: m.chat,
				subject: info?.subject || 'Group',
			},
		});
	},
};
