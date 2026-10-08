import { join } from 'path';

const pairingNumber = process.env.PAIRING_NUMBER;
const ownerNumbers = (process.env.OWNER_NUMBER || '')
	.split(',')
	.map((n) => n.trim())
	.filter(Boolean);
const publicMode = (process.env.PUBLIC_MODE || 'false').toLowerCase() === 'true';
const nodeEnv = process.env.NODE_ENV || 'production';
const prefixes = (process.env.PREFIX || '')
	.split(',')
	.map((p) => p.trim())
	.filter(Boolean);

export const config = {
	env: nodeEnv,
	isDev: nodeEnv === 'development',
	whatsapp: { pairingNumber, ownerNumbers },
	prefixes,
	bot: { publicMode },
	dataDir: join(process.cwd(), 'data'),
};

/** Restore a runtime-persisted mode override (survives restarts). */
export function applyRuntimeMode(mode) {
	if (mode === 'public' || mode === 'self') {
		config.bot.publicMode = mode === 'public';
	}
}

/** Fail fast when mandatory configuration is missing. */
export function validateConfig() {
	const missing = [];
	if (!ownerNumbers.length) missing.push('OWNER_NUMBER');
	if (!pairingNumber) missing.push('PAIRING_NUMBER');
	if (missing.length) throw new Error(`Configuration error: ${missing.join(', ')} not configured.`);
	for (const p of prefixes) {
		if (p.length > 4 || /\s/.test(p) || /[A-Za-z0-9]/.test(p)) {
			throw new Error(`Configuration error: invalid prefix "${p}" in PREFIX.`);
		}
	}
}
