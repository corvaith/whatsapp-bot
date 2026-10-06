/**
 * Send a payment request card.
 */
export default {
	commands: ['payreq'],
	category: 'experimental',
	description: 'Send a payment request. Usage: .payreq <amount> [note]',
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
