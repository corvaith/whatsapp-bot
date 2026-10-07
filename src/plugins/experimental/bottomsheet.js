/**
 * .bottomsheet — interactive message whose extra buttons collapse into a
 * native bottom sheet via messageParamsJson.bottom_sheet (@kyuu2nd recipe).
 */
import { generateMessageIDV2, proto } from 'baileys';

const json = (o) => JSON.stringify(o);
const SITE = 'https://github.com/corvaith';

export default {
	commands: ['bottomsheet'],
	category: 'experimental',
	description: 'Interactive card whose extra buttons collapse into a native bottom sheet. Usage: .bottomsheet <limit> | <title> | <btn1;btn2;...>',
	usage: '{prefix}bottomsheet 2 | Demo Sheet | Menu;Ping;Info;Help',
	react: '\u{1F5D1}\uFE0F',

	async run(context) {
		const { m, conn, text } = context;
		const [limitRaw, title, labelsRaw] = (text || '').split('|').map((p) => p.trim());
		const labels = (labelsRaw || '').split(/[;,]/).map((s) => s.trim()).filter(Boolean);
		if (!labels.length) {
			return m.reply(`Usage: ${m.prefix}bottomsheet <limit> | <title> | <button1;button2;...>`);
		}
		const limit = Math.max(1, Number.parseInt(limitRaw, 10) || 2);

		const buttons = labels.map((label, i) => ({
			name: 'quick_reply',
			buttonParamsJson: json({ display_text: label, id: `sheet_${i}` }),
		}));

		const im = proto.Message.InteractiveMessage.create({
			header: proto.Message.InteractiveMessage.Header.create({ title: title || 'Bottom Sheet Demo' }),
			body: proto.Message.InteractiveMessage.Body.create({
				text: `Only ${limit} button(s) stay in the thread; the rest collapse into the bottom sheet below.`,
			}),
			footer: proto.Message.InteractiveMessage.Footer.create({ text: 'whatsapp-bot' }),
			nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
				buttons,
				messageParamsJson: json({
					bottom_sheet: {
						in_thread_buttons_limit: limit,
						divider_indices: labels.map((_, i) => i + 1).concat([999]),
						list_title: title || 'Menu',
						button_title: 'Show more',
					},
					tap_target_configuration: {
						title: title || 'corvaith bot',
						description: 'Bottom sheet demo',
						canonical_url: SITE,
						domain: 'github.com',
						button_index: 0,
					},
				}),
				messageVersion: 1,
			}),
		});

		await conn.relayMessage(
			m.chat,
			{ interactiveMessage: im },
			{
				messageId: generateMessageIDV2(conn.user?.id),
				additionalNodes: [
					{
						tag: 'biz',
						attrs: {},
						content: [
							{ tag: 'interactive', attrs: { type: 'native_flow', v: '1' }, content: [{ tag: 'native_flow', attrs: { v: '9', name: 'mixed' } }] },
						],
					},
				],
			},
		);
	},
};
