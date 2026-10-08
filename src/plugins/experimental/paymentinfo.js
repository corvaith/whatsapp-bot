/**
 * .paymentinfo — "payment_info" native card (Pix-style static-code detail
 * sheet), shape taken verbatim from a working hand-relayed payload.
 */
import crypto from 'crypto';
import { generateMessageIDV2 } from 'baileys';

const KEY_TYPES = ['PHONE', 'EVP', 'CPF', 'CNPJ', 'EMAIL'];

export default {
	commands: ['paymentinfo'],
	category: 'experimental',
	description: 'Send a native payment_info card (Pix static code style). Usage: .paymentinfo <merchant> | <key> | [keytype] | [currency] | [amount]',
	usage: '{prefix}paymentinfo Hello World! | +6288279119895 | PHONE | BRL | 150.00',
	react: '💳',

	async run(context) {
		const { m, conn, text } = context;
		const [merchant, key, keyTypeRaw, currencyRaw, amountRaw] = (text || '').split('|').map((p) => p.trim());
		if (!merchant || !key) {
			return m.reply(`Usage: ${m.prefix}paymentinfo <merchant> | <pix key> | [${KEY_TYPES.join('|')}] | [currency] | [amount]`);
		}
		const keyType = KEY_TYPES.includes(keyTypeRaw?.toUpperCase()) ? keyTypeRaw.toUpperCase() : 'PHONE';
		const currency = (currencyRaw || 'BRL').toUpperCase();
		const amount = Number.parseFloat(amountRaw || '0') || 0;
		const cents = Math.round(amount * 100);

		const config = {
			currency,
			total_amount: { value: cents, offset: 100 },
			reference_id: crypto.randomBytes(6).toString('hex').toUpperCase().slice(0, 11),
			type: 'physical-goods',
			order: {
				status: 'pending',
				subtotal: { value: cents, offset: 100 },
				order_type: 'ORDER',
				items: [
					{
						name: merchant,
						amount: { value: cents, offset: 100 },
						quantity: 1,
						sale_amount: { value: cents, offset: 100 },
					},
				],
			},
			payment_settings: [
				{
					type: 'pix_static_code',
					pix_static_code: {
						merchant_name: merchant,
						key,
						key_type: keyType,
					},
				},
			],
			share_payment_status: false,
			is_soft_deleted: false,
			referral: 'chat_attachment',
		};

		await conn.relayMessage(
			m.chat,
			{
				messageContextInfo: {
					messageSecret: crypto.randomBytes(32),
				},
				interactiveMessage: {
					nativeFlowMessage: {
						buttons: [
							{
								name: 'payment_info',
								buttonParamsJson: JSON.stringify(config),
							},
						],
					},
					contextInfo: {
						expiration: 7776000,
						disappearingMode: { initiator: 0, trigger: 0 },
					},
				},
			},
			{
				messageId: generateMessageIDV2(conn.user?.id),
				additionalNodes: [
					{
						tag: 'biz',
						attrs: {},
						content: [{ tag: 'interactive', attrs: { type: 'native_flow', v: '1' }, content: [{ tag: 'native_flow', attrs: { name: 'payment_info' } }] }],
					},
				],
			},
		);
	},
};
