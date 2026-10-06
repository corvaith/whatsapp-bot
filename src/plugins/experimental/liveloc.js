/**
 * Send a live location card at the server's current location.
 */
export default {
	commands: ['liveloc'],
	category: 'experimental',
	description: "Send a live-location card at the bot's current location.",
	usage: '{prefix}liveloc [caption]',
	react: '📍',

	async run(context) {
		const { m, conn, text } = context;
		let loc;
		try {
			const res = await fetch('http://ip-api.com/json/', { signal: AbortSignal.timeout(8000) });
			loc = await res.json();
		} catch {
			return m.reply('Failed to detect location (geolocation service unreachable).');
		}
		if (loc.status !== 'success' || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lon)) {
			return m.reply('Failed to detect location.');
		}
		await conn.relayMessage(
			m.chat,
			{
				liveLocationMessage: {
					degreesLatitude: loc.lat,
					degreesLongitude: loc.lon,
					accuracyInMeters: 1000,
					speedInMps: 0,
					sequenceNumber: 1,
					timeOffset: 0,
					caption: (text || '').trim() || `${loc.city}, ${loc.regionName}, ${loc.country}`,
				},
			},
			{},
		);
	},
};
