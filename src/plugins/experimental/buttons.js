import { execFile } from 'child_process';
import { generateWAMessageFromContent, generateMessageIDV2, proto } from 'baileys';

/**
 * Interactive message with native-flow buttons (quick reply / url / copy).
 */

export const buttons = {
	commands: ['buttons'],
	category: 'experimental',
	description: 'Send an interactive button message',
	usage: '{prefix}buttons <text> | <button1> | <button2>',
	react: '🔘',

	async run(context) {
		const { m, conn, text } = context;
		const parts = (text || '')
			.split('|')
			.map((s) => s.trim())
			.filter(Boolean);
		const [body, ...labels] = parts.length >= 2 ? parts : ['Hello from the bot — pick an option below.', 'Ping', 'Info'];
		if (labels.length > 3) {
			return m.reply(`Usage: ${m.prefix}buttons <text> | <button1> | <button2> [| <button3>]`);
		}
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

/** Demo card covering every native-flow button type the client accepts. */

const json = (o) => JSON.stringify(o);
const SITE_buttons = 'https://github.com/corvaith';

const select = (title, icon, sections) => ({ name: 'single_select', buttonParamsJson: json({ title, sections, icon }) });

const ALL_BUTTONS = [
	{ name: 'quick_reply', buttonParamsJson: json({ display_text: 'Quick Reply', id: '.menu' }) },
	{ name: 'cta_url', buttonParamsJson: json({ display_text: 'GitHub', url: SITE_buttons, merchant_url: SITE_buttons }) },
	{
		name: 'open_webview',
		buttonParamsJson: json({ title: 'GitHub WebView', link: { in_app_webview: true, url: SITE_buttons } }),
	},
	{ name: 'cta_copy', buttonParamsJson: json({ display_text: 'Copy Code', copy_code: 'corvaith' }) },
	{ name: 'cta_call', buttonParamsJson: json({ display_text: 'Call Owner', phone_number: '6285719563093' }) },
	{ name: 'cta_reminder', buttonParamsJson: json({ display_text: 'Remind Me' }) },
	{ name: 'cta_cancel_reminder', buttonParamsJson: json({ display_text: 'Cancel Reminder' }) },
	{ name: 'send_location', buttonParamsJson: '{}' },
	{ name: 'request_contact_info', buttonParamsJson: '{}' },
	{ name: 'address_message', buttonParamsJson: '{}' },
	{
		name: 'mpm',
		buttonParamsJson: json({ product_id: '8816262248471474' }),
	},
	{
		name: 'wa_payment_transaction_details',
		buttonParamsJson: json({ transaction_id: '12345848' }),
	},
	{
		name: 'automated_greeting_message_view_catalog',
		buttonParamsJson: json({
			business_phone_number: '6285719563093',
			catalog_product_id: '8816262248471474',
		}),
	},
	select('Select Default', 'DEFAULT', [
		{
			title: 'Main',
			highlight_label: 'Menu',
			rows: [
				{ header: 'BOT', title: 'Menu', description: 'Show all commands', id: '.menu' },
				{ header: 'BOT', title: 'Ping', description: 'Check bot speed', id: '.ping' },
			],
		},
	]),
	select('Select Review', 'REVIEW', [
		{
			title: 'Utility',
			highlight_label: 'Tools',
			rows: [
				{ header: 'TOOLS', title: 'Ping', description: 'Check bot speed', id: '.ping' },
				{ header: 'TOOLS', title: 'Info', description: 'Bot runtime info', id: '.info' },
			],
		},
	]),
	select('Select Promo', 'PROMOTION', [
		{
			title: 'Promotion',
			highlight_label: 'Promo',
			rows: [
				{ header: 'PROMO', title: 'Promo', description: 'Show promotion', id: '.promo' },
				{ header: 'PROMO', title: 'Claim', description: 'Claim promotion', id: '.claim' },
			],
		},
	]),
	select('Select Document', 'DOCUMENT', [
		{
			title: 'Document',
			highlight_label: 'Docs',
			rows: [
				{ header: 'DOCS', title: 'Docs', description: 'Show documentation', id: '.help' },
				{ header: 'DOCS', title: 'Guide', description: 'Show guide', id: '.help' },
			],
		},
	]),
];

export const allbuttons = {
	commands: ['allbuttons'],
	category: 'experimental',
	description: 'Show a demo of every native-flow button type (reply, url, webview, copy, call, reminder, location, address, catalog, payment, greeting-catalog, select icons).',
	usage: '{prefix}allbuttons',
	react: '\u{1F39B}\uFE0F',

	async run(context) {
		const { m, conn } = context;
		const im = proto.Message.InteractiveMessage.create({
			header: proto.Message.InteractiveMessage.Header.create({ title: 'All Buttons Demo', subtitle: 'every native-flow type' }),
			body: proto.Message.InteractiveMessage.Body.create({
				text: 'Every button type this client supports.\nNote: catalog / payment / greeting flows use demo IDs - the buttons render, the targets are placeholders.',
			}),
			footer: proto.Message.InteractiveMessage.Footer.create({ text: 'whatsapp-bot' }),
			nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
				buttons: ALL_BUTTONS,
				messageParamsJson: json({
					limited_time_offer: { text: 'Latest version', url: SITE_buttons, copy_code: 'corvaith', expiration_time: 4102444800000 },
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
						content: [{ tag: 'interactive', attrs: { type: 'native_flow', v: '1' }, content: [{ tag: 'native_flow', attrs: { v: '9', name: 'mixed' } }] }],
					},
				],
			},
		);
	},
};

export const bottomsheet = {
	commands: ['bottomsheet'],
	category: 'experimental',
	description: 'Interactive card whose extra buttons collapse into a native bottom sheet.',
	usage: '{prefix}bottomsheet 2 | Demo Sheet | Menu;Ping;Info;Help',
	react: '\u{1F5D1}\uFE0F',

	async run(context) {
		const { m, conn, text } = context;
		const [limitRaw, title, labelsRaw] = (text || '').split('|').map((p) => p.trim());
		const labels = (labelsRaw || '')
			.split(/[;,]/)
			.map((s) => s.trim())
			.filter(Boolean);
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
						canonical_url: SITE_buttons,
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
						content: [{ tag: 'interactive', attrs: { type: 'native_flow', v: '1' }, content: [{ tag: 'native_flow', attrs: { v: '9', name: 'mixed' } }] }],
					},
				],
			},
		);
	},
};

export default [buttons, allbuttons, bottomsheet];
