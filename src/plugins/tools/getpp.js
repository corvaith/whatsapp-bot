const HELP = (prefix) =>
	`*${prefix}getpp* — get a profile picture\n\n` + '• Mention someone\n' + '• Reply to their message\n' + '• `me` — your own picture\n' + '• In a private chat: the other person picture';

const digits = (jid) => String(jid || '').replace(/[^0-9]/g, '');

/** Resolve the target JID: mention → quoted sender → arg (me/number) → default. */
function resolveTarget({ m, args, conn }) {
	const mention = m.msg?.contextInfo?.mentionedJid?.[0];
	if (mention) return conn.getJid(mention);
	if (m.isQuoted && m.quoted?.sender) return m.quoted.sender;
	const arg = args[0]?.toLowerCase();
	if (arg === 'me') return m.sender;
	if (arg && /^\+?\d{7,15}$/.test(arg.replace(/\D/g, ''))) return `${arg.replace(/\D/g, '')}@s.whatsapp.net`;
	if (arg && arg !== 'me') return null;
	return m.isGroup ? m.sender : m.chat;
}

export default {
	commands: ['getpp', 'pp', 'profilepic', 'avatar'],
	category: 'tools',
	description: 'Get a user or group profile picture.',
	usage: '{prefix}getpp [@mention | reply | me | <number>]\n{prefix}getpp group',
	react: '🖼️',

	async run({ m, args, conn, prefix }) {
		if (args[0]?.toLowerCase() === 'group') {
			if (!m.isGroup) return m.reply('This option only works in groups.');
			return this.sendPicture({ m, conn, jid: m.chat, label: 'Group' });
		}

		const target = resolveTarget({ m, args, conn });
		if (!target) return m.reply(HELP(prefix));
		await this.sendPicture({ m, conn, jid: target, label: `@${digits(target)}`, mentions: [target] });
	},

	async sendPicture({ m, conn, jid, label, mentions = [] }) {
		try {
			const url = await conn.profilePictureUrl(jid, 'image');
			if (!url) throw new Error('not found');
			await m.reply({ image: { url }, caption: `Profile picture of ${label}`, mentions });
			try {
				const biz = await conn.getBusinessProfile(jid);
				if (biz && typeof biz === 'object' && Object.keys(biz).length) {
					const fields = [
						['Name', biz.name || biz.description?.name],
						['Category', biz.category],
						['Description', biz.description],
						['Address', biz.address],
						['Email', biz.email],
						['Website', biz.website],
					].filter(([, v]) => v);
					if (fields.length) await m.reply(`*WA Business info:*\n${fields.map(([k, v]) => `• *${k}:* ${v}`).join('\n')}`);
				}
			} catch {}
		} catch {
			await m.react('❌');
			await m.reply('Profile picture not found or privacy is restricted.');
		}
	},
};
