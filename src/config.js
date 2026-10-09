import { join } from 'path';

const pairingNumber = process.env.PAIRING_NUMBER;
const publicMode = (process.env.PUBLIC_MODE || 'false').toLowerCase() === 'true';
const nodeEnv = process.env.NODE_ENV || 'production';
const prefixes = (process.env.PREFIX || '')
	.split(',')
	.map((p) => p.trim())
	.filter(Boolean);

const ownerNumbers = (process.env.OWNER_NUMBER || '')
	.split(',')
	.map((n) => n.trim().replace(/[^0-9]/g, ''))
	.filter(Boolean);
const ownerLids = new Set(
	(process.env.OWNER_LID || '')
		.split(',')
		.map((l) => l.trim())
		.filter((l) => l.endsWith('@lid')),
);

/** Remember the LID form of a config owner (called once the pair is observed). */
export function registerOwnerLid(lid) {
	if (typeof lid === 'string' && lid.endsWith('@lid')) ownerLids.add(lid);
}

export const isOwnerJid = (jid) => {
	const digits = String(jid || '').replace(/[^0-9]/g, '');
	return ownerNumbers.includes(digits) || ownerLids.has(jid);
};

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

export const MTIME_THROTTLE_MS = 1000;
export const PAIRING_DELAY_MS = 3000;

export const MAX_FETCH_BYTES = 20 * 1024 * 1024;

/**
 * Centralized bot response templates — edit wording here, no plugin changes needed.
 */
export const RESPONSES = {
	groupOnly: 'This command can only be used in a group.',
	botNotAdmin: 'I need to be a group admin to do that.',
	notAdmin: 'Only group admins can use this command.',
	noTarget: 'Mention or reply to the member, or pass a number. Usage: {usage}',
	selfTarget: "That's me — I won't do that to myself.",
	notInGroup: '@{num} is not a member of this group.',
	alreadyAdmin: '@{num} is already an admin.',
	targetNotAdmin: '@{num} is not an admin.',
	kickDone: '✓ Kicked {num}.',
	promoteDone: '✓ Promoted {num} to admin.',
	demoteDone: '✓ Demoted {num}.',
	actionFailed: 'Failed ({status}). Make sure I am an admin and the target is a member.',
};

export const CUSTOM_COMMAND_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const GROUP_STATS_TTL_MS = 30 * 24 * 60 * 60 * 1000;
