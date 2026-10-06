/**
 * Get the group invite link.
 */
export default {
	commands: ['glink', 'gclink'],
	category: 'experimental',
	description: 'Get this group invite link.',
	usage: '{prefix}glink',
	react: '🔗',

	async run(context) {
		const { m, conn } = context;
		if (!m.isGroup) return m.reply('Run this inside a group.');
		const code = await conn.groupInviteCode(m.chat);
		if (!code) return m.reply('Could not get the invite code (bot may not be admin).');
		await m.reply(`https://chat.whatsapp.com/${code}`);
	},
};
