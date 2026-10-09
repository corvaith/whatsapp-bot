/**
 * Send a location card from latitude/longitude.
 */
export default {
	commands: ['location', 'loc'],
	category: 'experimental',
	description: 'Provides a location map according to the IP you provide.',
	usage: '{prefix}loc <lat> <lon> [name]',

	async run(context) {
		const { m, text } = context;
		const parts = (text || '').trim().split(/\s+/);
		const lat = parseFloat(parts[0]);
		const lon = parseFloat(parts[1]);
		if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
			return m.reply(`Usage: ${m.prefix}loc <lat> <lon> [name]\nExample: ${m.prefix}loc -6.2 106.816 Monas`);
		}
		const name = parts.slice(2).join(' ') || undefined;
		await m.reply({
			location: {
				degreesLatitude: lat,
				degreesLongitude: lon,
				name,
				address: name,
			},
		});
	},
};
