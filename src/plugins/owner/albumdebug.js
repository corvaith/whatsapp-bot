/**
 * Temporary album wire-shape debugging (owner only).
 * .albumdebug on  -> dump the next 10 incoming raw messages to /tmp/album-dump.json
 *                    AND dump the next outgoing album relays (ours) to /tmp/album-sent.json
 * .albumdebug off -> stop
 */
let active = false;
let count = 0;
let handler = null;

const flatten = (obj) => JSON.parse(JSON.stringify(obj, (k, v) => (v && v.type === 'Buffer' ? Buffer.from(v.data).toString('base64').slice(0, 16) + '…' : v)));

export default {
	commands: ['albumdebug'],
	category: 'experimental',
	description: 'Toggle logging of raw incoming message wire data (album debugging).',
	usage: '{prefix}albumdebug on|off',
	access: 'owner',

	async run(context) {
		const { m, conn, text } = context;
		const arg = (text || '').trim().toLowerCase();

		if (arg === 'on') {
			if (handler) conn.ev.off('messages.upsert', handler);
			active = true;
			count = 0;
			const fsModule = await import('fs');
			fsModule.writeFileSync('/tmp/album-dump.json', '');
			fsModule.writeFileSync('/tmp/album-sent.json', '');
			handler = ({ messages }) => {
				if (!active || count >= 10) return;
				for (const raw of messages || []) {
					if (!raw?.message) continue;
					fsModule.appendFileSync('/tmp/album-dump.json', JSON.stringify(flatten(raw), null, 1) + '\n---\n');
					count++;
				}
				if (count >= 10) {
					conn.ev.off('messages.upsert', handler);
					handler = null;
					active = false;
				}
			};
			conn.ev.on('messages.upsert', handler);

			// Tap outgoing relays while active so we can diff ours vs the real capture.
			conn._albumDebugRelay = conn.relayMessage.bind(conn);
			conn.relayMessage = async (jid, message, opts) => {
				if (active && message && (message.albumMessage || message.messageContextInfo?.messageAssociation)) {
					fsModule.appendFileSync('/tmp/album-sent.json', JSON.stringify(flatten(message), null, 1) + '\n---\n');
				}
				return conn._albumDebugRelay(jid, message, opts);
			};

			await m.reply('albumdebug ON — send an album (2+ photos) from your phone now. Max 10 messages captured. Outgoing album relays are also dumped.');
		} else if (arg === 'off') {
			active = false;
			if (handler) {
				conn.ev.off('messages.upsert', handler);
				handler = null;
			}
			if (conn._albumDebugRelay) {
				conn.relayMessage = conn._albumDebugRelay;
				delete conn._albumDebugRelay;
			}
			await m.reply(`albumdebug OFF (captured: ${count})`);
		} else {
			await m.reply(`Usage: ${m.prefix}albumdebug on|off (captured: ${count})`);
		}
	},
};
