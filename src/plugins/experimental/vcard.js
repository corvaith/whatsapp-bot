/**
 * Send a contact card (vCard) from a phone number.
 */
export default {
	commands: ['vcard', 'contact'],
	category: 'experimental',
	description: 'Send a contact card. Usage: .vcard <number> [name]',
	usage: '{prefix}vcard <number> [name]',

	async run(context) {
		const { m, text } = context;
		const [number, ...nameParts] = (text || '').trim().split(/\s+/);
		if (!number || !/^\+?\d{8,15}$/.test(number.replace(/[\s-]/g, ''))) {
			return m.reply(`Usage: ${m.prefix}vcard <number> [name]`);
		}
		const clean = number.replace(/[^\d]/g, '');
		const name = nameParts.join(' ') || clean;
		const vcard =
			'BEGIN:VCARD\n' +
			'VERSION:3.0\n' +
			`FN:${name}\n` +
			`TEL;type=CELL;type=VOICE;waid=${clean}:+${clean}\n` +
			'END:VCARD';
		await m.reply({ contacts: { displayName: name, contacts: [{ vcard }] } });
	},
};
