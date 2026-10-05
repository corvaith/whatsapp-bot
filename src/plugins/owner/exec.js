import util from 'util';
import cp from 'child_process';

/**
 * Execute a shell command (owner only).
 */
export default {
	category: 'owner',
	helpName: 'exec',
	description: 'Execute a shell command.',
	access: 'owner',
	match: ({ m }) => m.body?.startsWith('$'),

	async run({ m }) {
		const exec = util.promisify(cp.exec);
		try {
			const { stdout, stderr } = await exec(m.text);
			if (stdout.trim()) await m.reply(stdout);
			if (stderr.trim()) await m.reply(stderr);
		} catch (err) {
			if (err.stdout?.trim()) await m.reply(err.stdout);
			if (err.stderr?.trim()) await m.reply(err.stderr);
		}
	},
};
