/**
 * Show a demo of every interactive button type WhatsApp supports.
 */
import { generateWAMessageFromContent, proto } from 'baileys';

const json = (o) => JSON.stringify(o);

const buttons = [
	{ name: 'quick_reply', buttonParamsJson: json({ display_text: 'Quick Reply', id: 'demo_quick' }) },
	{
		name: 'cta_url',
		buttonParamsJson: json({ display_text: 'Open URL', url: 'https://github.com', merchant_url: 'https://github.com' }),
	},
	{ name: 'cta_copy', buttonParamsJson: json({ display_text: 'Copy Code', copy_code: 'DEMO-1234' }) },
	{ name: 'cta_call', buttonParamsJson: json({ display_text: 'Call Number', phone_number: '+6285719563093' }) },
	{
		name: 'single_select',
		buttonParamsJson: json({
			title: 'Open List',
			sections: [
				{
					title: 'Section One',
					rows: [
						{ header: 'H1', title: 'List Row 1', description: 'First option', id: 'demo_row1' },
						{ header: 'H2', title: 'List Row 2', description: 'Second option', id: 'demo_row2' },
					],
				},
			],
		}),
	},
	{ name: 'send_location', buttonParamsJson: json({ display_text: 'Share Location' }) },
	{ name: 'address_message', buttonParamsJson: json({ display_text: 'Share Address' }) },
	{ name: 'cta_reminder', buttonParamsJson: json({ display_text: 'Reminder' }) },
	{ name: 'cta_cancel_reminder', buttonParamsJson: json({ display_text: 'Cancel Reminder' }) },
	{ name: 'open_webview', buttonParamsJson: json({ display_text: 'Web View', url: 'https://example.com', view: 'webview_demo' }) },
];

export default {
	commands: ['allbuttons'],
	category: 'experimental',
	description: 'Show a demo of every interactive button type (reply, url, copy, call, list, location, address, reminder, webview).',
	usage: '{prefix}allbuttons',
	react: '🎛️',

	async run(context) {
		const { m, conn } = context;
		const im = proto.Message.InteractiveMessage.create({
			header: proto.Message.InteractiveMessage.Header.create({ title: 'All Buttons Demo', subtitle: 'every type' }),
			body: proto.Message.InteractiveMessage.Body.create({
				text: 'Every button type this WhatsApp client supports.\nNote: business-only flows (mpm, catalog, payment) are skipped.',
			}),
			footer: proto.Message.InteractiveMessage.Footer.create({ text: 'whatsapp-bot' }),
			nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
				buttons,
				messageParamsJson: '{}',
				messageVersion: 1,
			}),
		});
		const msg = generateWAMessageFromContent(m.chat, { interactiveMessage: im }, { userJid: conn.user.id });
		const bizNode = {
			tag: 'biz',
			attrs: { actual_actors: '2', host_storage: '2' },
			content: [
				{ tag: 'interactive', attrs: { type: 'native_flow', v: '1' }, content: [{ tag: 'native_flow', attrs: { v: '9', name: 'mixed' } }] },
				{ tag: 'quality_control', attrs: { source_type: 'third_party' } },
			],
		};
		await conn.relayMessage(m.chat, msg.message, { messageId: msg.key.id, additionalNodes: [bizNode] });
	},
};
