import { fetchLatestWaWebVersion } from 'baileys';

import { config, PAIRING_DELAY_MS } from '#config.js';

import makeWASocket from '#whatsapp/messages.js';
import authState from '#whatsapp/auth.js';

import { registerEvents } from './events.js';
import crmStore from '#services/crmStore.js';
import { loadMode } from '#services/botMode.js';

/**
 * Create the WhatsApp socket, wire event handlers and start the session.
 * @param {import('../core/plugins.js').PluginRegistry} registry
 */
export async function startBot(registry) {
	loadMode();

	const { auth, saveCreds } = await authState();
	const { version } = await fetchLatestWaWebVersion();

	const conn = await makeWASocket({
		auth,
		version,
	});

	registerEvents(conn, registry, () => startBot(registry));

	crmStore.bind(conn);

	if (!conn.authState.creds.registered) {
		setTimeout(async () => {
			try {
				const code = await conn.requestPairingCode(config.whatsapp.pairingNumber);
				conn.logger.info(`Pairing Code: ${code}\n`);
			} catch (err) {
				conn.logger.error(err, 'Failed to create pairing code:');
			}
		}, PAIRING_DELAY_MS);
	}

	conn.ev.on('creds.update', saveCreds);
	conn.groups = {};
}
