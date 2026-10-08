import { fetchLatestWaWebVersion } from 'baileys';

import { config } from '#config/environment.js';
import { PAIRING_DELAY_MS } from '#config/constants.js';

import makeWASocket from '#whatsapp/message/serialize.js';
import authState from '#whatsapp/auth/auth-state.js';

import handleContact from '#events/contacts.js';
import handleConnection from '#events/connection.js';
import handleGroups from '#events/groups.js';
import handleMessage from '#events/messages.js';
import crmStore from '#services/crm-store.js';
import { loadMode } from '#services/bot-mode.js';

/**
 * Create the WhatsApp socket, wire event handlers and start the session.
 * @param {import('../core/plugin-registry.js').PluginRegistry} registry
 */
export async function startBot(registry) {
	// Restore the runtime mode override before anything reads config.bot.
	loadMode();

	const { auth, saveCreds } = await authState();
	const { version } = await fetchLatestWaWebVersion();

	const conn = await makeWASocket({
		auth,
		version,
	});

	handleContact(conn);
	handleConnection(conn, () => startBot(registry));
	handleGroups(conn);
	handleMessage(conn, registry);

	// Persist incoming/outgoing messages + ws nodes for .crm owner tooling.
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
