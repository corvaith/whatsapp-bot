import { DisconnectReason } from 'baileys';

export default function (conn, restart = () => startBot()) {
	conn.ev.on('connection.update', async (update) => {
		const { connection, lastDisconnect } = update;

		if (connection === 'close') {
			const error = lastDisconnect?.error;
			const statusCode = error?.output?.statusCode;
			const outMsg = error?.output?.payload?.message || error?.message;

			// 401 loggedOut / 411 multideviceMismatch / 405 build ditolak server: stop.
			if ([DisconnectReason.loggedOut, DisconnectReason.multideviceMismatch, 405].includes(statusCode)) {
				conn.logger.fatal(outMsg);
				process.exit(1);
			}

			// 403 forbidden = ban sementara; tunggu error.data.expire (unix detik) baru restart.
			if (statusCode === DisconnectReason.forbidden) {
				const expire = error?.data?.expire;
				const waitMs = typeof expire === 'number' && expire > Date.now() / 1000 ? expire * 1000 - Date.now() + 5000 : 5000;
				conn.logger.warn(`Temporary ban (${outMsg}); retrying in ${Math.round(waitMs / 1000)}s`);
				await waitUntil(Date.now() + waitMs);
				return restart();
			}

			// Lainnya (428/408/440/500/515/503...): buat socket baru.
			if (conn?.pendingContactSaves > 0) {
				conn.logger.info('Waiting for contacts to be saved...');
				const deadline = Date.now() + 5000;
				while (conn.pendingContactSaves > 0 && Date.now() < deadline) {
					await new Promise((resolve) => setTimeout(resolve, 50));
				}
			}

			conn.logger.info('Reconnecting...');
			await restart();
		} else if (connection === 'open') {
			conn.logger.info('Bot connected to WhatsApp');
			const sync = conn.logger.time('sync grup');
			conn.groups = await conn.groupFetchAllParticipating();
			sync.end('info');
		}
	});
}

// setTimeout caps ~2^31-1 ms (~24.8 hari); ban panjang harus di-chunk.
function waitUntil(deadlineMs) {
	return new Promise(async (resolve) => {
		for (let left = deadlineMs - Date.now(); left > 0; left = deadlineMs - Date.now()) {
			await new Promise((r) => setTimeout(r, Math.min(left, 2_147_483_647)));
		}
		resolve();
	});
}
