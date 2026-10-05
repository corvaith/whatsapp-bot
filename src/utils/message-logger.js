/**
 * Compact per-message log line; avoids dumping serialized objects.
 */
export default function (conn, m) {
	if (m.type === 'protocolMessage') return;
	const sender = m.pushname || m.sender;
	const content = m.isMedia ? `[${(m.msg?.mimetype || 'media').split('/')[0]}]` : m.body || m.type;
	conn.logger.info(`Message from ${sender}${m.isGroup ? ` in ${m.chat}` : ''}: ${content}`);
}
