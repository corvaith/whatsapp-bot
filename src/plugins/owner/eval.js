import util from 'util';
import cp from 'child_process';
import os from 'os';

import * as b from 'baileys';

import { formatSize, toTime } from '#utils/format.js';

/**
 * Execute JavaScript (owner only). The scope intentionally mirrors the
 * historical eval environment so old snippets keep working.
 */
export default {
	category: 'owner',
	helpName: 'eval',
	description: 'Execute JavaScript.',
	access: 'owner',
	match: ({ m }) => ['>', '=>'].some((prefix) => m.body?.startsWith(prefix)),

	async run({ conn, m, isOwner, isCommand, quoted, downloadMedia }) {
		let result = '';
		try {
			const text = m.text.trim();
			const code = !/\breturn\b/.test(text) && !(/[;\n]/.test(text) || text.startsWith('>')) ? `return ${text}` : m.text;

			result = /await/i.test(m.text) ? eval('(async() => { ' + code + ' })()') : eval('(() => { ' + code + ' })()');
			if (result instanceof Promise) result = await result;
		} catch (err) {
			result = err;
		}
		await m.reply(util.format(result));
	},
};
