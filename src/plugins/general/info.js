import os from 'os';

import { formatSize, toTime } from '#utils/format.js';

/**
 * Show bot and server information.
 */
export default {
	commands: ['info'],
	category: 'general',
	description: 'Show bot and server information.',
	usage: '{prefix}info',

	async run({ m }) {
		const startedAt = Date.now();
		await m.react('🍌');

		const totalMem = os.totalmem();
		const usedMem = totalMem - os.freemem();
		const memPercent = ((usedMem / totalMem) * 100).toFixed(1);

		const memoryUsage = Object.entries(process.memoryUsage())
			.map(([key, value]) => `* ${key.padEnd(12)} : ${formatSize(value)}`)
			.join('\n');

		m.reply(
			`\`Server Information\`
* Bot speed  : ${Date.now() - startedAt} ms
* Bot uptime : ${toTime(process.uptime() * 1000)}
* Server uptime : ${toTime(os.uptime() * 1000)}
* Memory     : ${formatSize(usedMem)} / ${formatSize(totalMem)} (${memPercent}%)
* CPU        : ${os.cpus()[0].model}
* Release    : ${os.release()}
* Type       : ${os.type()}

\`Memory Usage\`
${memoryUsage}`,
		);
	},
};
