/**
 * Interactive message with native-flow buttons (quick reply / url / copy).
 */
import { generateWAMessageFromContent, proto } from 'baileys';

export default {
	commands: ['buttons'],
	category: 'experimental',
	description: 'Send an interactive button message. Usage: .buttons Text | Btn1 | Btn2',
	usage: '{prefix}buttons <text> | <button1> | <button2> [| ...]',
	react: '🔘',

	async run(context) {
		const { m, conn, text } = context;
		const parts = (text || '')
			.split('|')
			.map((s) => s.trim())
			.filter(Boolean);
		if (parts.length < 2 || parts.length > 4) {
			return m.reply(`Usage: ${m.prefix}buttons <text> | <button1> | <button2> [| <button3>]`);
		}
		const [body, ...labels] = parts;
		const im = proto.Message.InteractiveMessage.create({
			body: proto.Message.InteractiveMessage.Body.create({ text: body }),
			footer: proto.Message.InteractiveMessage.Footer.create({ text: 'whatsapp-bot' }),
			nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
				buttons: labels.map((label, i) => ({
					name: 'quick_reply',
					buttonParamsJson: JSON.stringify({ display_text: label, id: `btn_${i}` }),
				})),
				messageVersion: 1,
			}),
		});
		const msg = generateWAMessageFromContent(m.chat, { interactiveMessage: im }, { userJid: conn.user.id });
		await conn.relayMessage(m.chat, msg.message, { messageId: msg.key.id });
	},
};
