import crypto from 'crypto';
import { generateMessageIDV2, proto } from 'baileys';

/** Native review-and-pay order card with a selectable account list. */

const WALLETS = ['DANA', 'OVO', 'GoPay', 'ShopeePay', 'LinkAja'];

const amountParts = (amount) => ({ value: Math.round(amount * 100), offset: 100 });

const account = (institution, beneficiary, type, identifier) => ({
	type: 'payment_account',
	payment_account: {
		account_type: type,
		identifier_type: identifier,
		identifier_value: '08888',
		institution_name: institution,
		beneficiary_name: beneficiary,
	},
});

const buildPaymentConfig = (amount, description, beneficiary, institutions) => ({
	currency: 'IDR',
	payment_configuration: '',
	payment_type: 'upr',
	total_amount: amountParts(amount),
	reference_id: `PAY-${Date.now()}`,
	type: 'physical-goods',
	order: {
		status: 'pending',
		description,
		subtotal: amountParts(amount),
		tax: { value: 0, offset: 100 },
		discount: { value: 0, offset: 100 },
		shipping: { value: 0, offset: 100 },
		order_type: 'PAYMENT_REQUEST',
		items: [{ name: description, amount: amountParts(amount), quantity: 1 }],
	},
	payment_settings: institutions.map((ins) => (WALLETS.includes(ins) ? account(ins, beneficiary, 'digital_wallet', 'phone_number') : account(ins, beneficiary, 'bank_account', 'id_account_number'))),
	additional_note: description,
	native_payment_methods: [],
	share_payment_status: false,
	is_soft_deleted: false,
});

const DEFAULT_BANKS = ['SeaBank', 'Bank Jago', 'Bank Central Asia', 'Bank Mandiri', 'DANA', 'GoPay', 'OVO'];

export const payment = {
	commands: ['payment'],
	category: 'experimental',
	description: 'Send a native review_and_pay order card with bank/e-wallet accounts',
	usage: '{prefix}payment 250000 | Premium Plan | Toko Kita | SeaBank;DANA;GoPay',
	react: '🧾',

	async run(context) {
		const { m, conn, text } = context;
		const [amountRaw, description, beneficiary, banksRaw] = (text || '').split('|').map((p) => p.trim());
		const amount = Number.parseFloat((amountRaw || '').replace(/[^\d.]/g, ''));
		if (!Number.isFinite(amount) || amount <= 0) {
			return m.reply(`Usage: ${m.prefix}payment <amount> | <description> | <beneficiary> | [banks;separated]\nDefault banks: ${DEFAULT_BANKS.join(', ')}`);
		}
		const desc = description || 'Payment';
		const who = beneficiary || 'Merchant';
		const institutions = banksRaw
			? banksRaw
					.split(/[;,]/)
					.map((s) => s.trim())
					.filter(Boolean)
			: DEFAULT_BANKS;

		const im = proto.Message.InteractiveMessage.create({
			header: proto.Message.InteractiveMessage.Header.create({ title: desc, subtitle: who }),
			body: proto.Message.InteractiveMessage.Body.create({ text: `Payment request for ${who}\nAmount: IDR ${amount.toLocaleString('id-ID')}` }),
			footer: proto.Message.InteractiveMessage.Footer.create({ text: 'whatsapp-bot' }),
			nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
				buttons: [
					{
						name: 'review_and_pay',
						buttonParamsJson: JSON.stringify(buildPaymentConfig(amount, desc, who, institutions)),
					},
				],
				messageParamsJson: '{}',
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
						attrs: {
							actual_actors: '2',
							host_storage: '2',
							native_flow_name: 'order_details',
						},
						content: [
							{
								tag: 'quality_control',
								attrs: { source_type: 'third_party' },
								content: [{ tag: 'decision_source', attrs: { value: 'df' } }],
							},
						],
					},
				],
			},
		);
	},
};

/** Native payment-info card with a static payment code. */

const KEY_TYPES = ['PHONE', 'EVP', 'CPF', 'CNPJ', 'EMAIL'];

export const paymentinfo = {
	commands: ['paymentinfo'],
	category: 'experimental',
	description: 'Send a native payment_info card (Pix static code style)',
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

/**
 * Send a payment request card.
 */
export const payreq = {
	commands: ['payreq'],
	category: 'experimental',
	description: 'Send a payment request bubble for the given amount.',
	usage: '{prefix}payreq <amount> [note]',
	react: '💰',

	async run(context) {
		const { m, conn, text } = context;
		const [amountRaw, ...noteParts] = (text || '').trim().split(/\s+/);
		const amount = parseInt(amountRaw, 10);
		if (!Number.isFinite(amount) || amount <= 0) {
			return m.reply(`Usage: ${m.prefix}payreq <amount IDR> [note]`);
		}
		const note = noteParts.join(' ') || 'Payment request';
		await conn.relayMessage(
			m.chat,
			{
				requestPaymentMessage: {
					currencyCodeIso4217: 'IDR',
					amount1000: amount * 1000,
					requestFrom: m.chat,
					noteMessage: { extendedTextMessage: { text: note } },
				},
			},
			{},
		);
	},
};

export default [payment, paymentinfo, payreq];
