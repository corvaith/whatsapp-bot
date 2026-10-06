/**
 * Pin / unpin a message in the chat (reply to it).
 */
import { proto } from 'baileys';

export default {
	commands: ['pin'],
	category: 'experimental',
	description: 'Pin a message. Reply to it with: .pin [1h|7d|30d] (or .pin off to unpin)',
	usage: '{prefix}pin [1h|7d|30d|off] (reply to a message)',

	async run(context) {
		const { m, conn, text } = context;
		if (!m.isQuoted) return m.reply(`Usage: reply to a message with ${m.prefix}pin [1h|7d|30d|off]`);
		const arg = (text || '').trim().toLowerCase();
		const durations = { '': 604800, '1h': 86400, '7d': 604800, '30d': 2592000 };
		const off = arg === 'off' || arg === 'unpin';
		if (!off && !(arg in durations)) {
			return m.reply(`Usage: ${m.prefix}pin [1h|7d|30d|off]`);
		}
		await conn.sendMessage(m.chat, {
			pin: m.quoted.key,
			type: off ? proto.PinInChat.Type.UNPIN_FOR_ALL : proto.PinInChat.Type.PIN_FOR_ALL,
			time: off ? 0 : durations[arg],
		});
	},
};
