// Single source of truth for command parsing and prefix resolution.
// Priority: runtime (settings store) > env PREFIX > DEFAULT_PREFIXES.
import { config } from '#config/environment.js';

// Keeps default behaviour identical to the old PREFIX_PATTERN char class.
export const DEFAULT_PREFIXES = ['°', '•', 'π', '÷', '×', '¶', '∆', '£', '¢', '€', '¥', '®', '™', '+', '✓', '=', '|', '/', '~', '!', '?', '@', '#', '%', '^', '&', '.', '©'];

// Reserved by owner triggers (eval/exec) which run without a prefix.
const RESERVED = ['>', '=>', '$'];

const normalize = (value) => String(value ?? '').trim();

/** Validate a single prefix value. Returns { ok, error? }. */
export function validatePrefix(value) {
	const v = normalize(value);
	if (!v) return { ok: false, error: 'Prefix kosong.' };
	if (v.length > 4) return { ok: false, error: `"${v}" terlalu panjang (maksimal 4 karakter).` };
	if (/\s/.test(v)) return { ok: false, error: `"${v}" mengandung spasi.` };
	if (/[A-Za-z0-9]/.test(v)) return { ok: false, error: `"${v}" tidak boleh huruf atau angka.` };
	if (RESERVED.includes(v)) return { ok: false, error: `"${v}" dipakai trigger owner (eval/exec).` };
	return { ok: true };
}

let runtimePrefixes = null; // JSON array from settings store, or null when unset

/** Called by settings loader at startup (and by setprefix/resetprefix). */
export function setRuntimePrefixes(value) {
	if (value === null || value === undefined) {
		runtimePrefixes = null;
		return;
	}
	const list = Array.isArray(value) ? value : JSON.parse(value);
	runtimePrefixes = Array.isArray(list) && list.length ? list.map(normalize).filter(Boolean) : null;
}

function envPrefixes() {
	const raw = process.env.PREFIX;
	if (!raw) return null;
	const list = raw.split(',').map(normalize).filter(Boolean);
	for (const p of list) {
		if (!validatePrefix(p).ok) throw new Error(`Configuration error: invalid prefix "${p}" in PREFIX.`);
	}
	return list.length ? list : null;
}

/** Active prefixes, longest first so multi-char prefixes win matching. */
export function getPrefixes() {
	const source = runtimePrefixes || envPrefixes() || DEFAULT_PREFIXES;
	const seen = new Set();
	return [...source].filter((p) => (seen.has(p) ? false : (seen.add(p), true))).sort((a, b) => b.length - a.length);
}

/**
 * Parse a message body into command fields. When no configured prefix matches,
 * prefix is '' and the remaining fields are computed exactly like the old
 * parser did (so trigger-only plugins such as eval/exec keep working).
 * @returns {{ prefix: string, command: string, args: string[], text: string, rawText: string, cmd: string }}
 */
export function parseCommand(body) {
	const trimmed = (body || '').trim();
	let prefix = '';
	for (const p of getPrefixes()) {
		if (p && trimmed.startsWith(p)) {
			prefix = p;
			break;
		}
	}
	const after = prefix ? trimmed.slice(prefix.length) : trimmed;
	const args = trimmed.split(/ +/).slice(1);
	const command = after.trim().split(/ +/).shift() || '';
	const cmd = prefix + command;
	const afterCommand = after.trim().slice(command.length);
	const rawText = afterCommand.replace(/^ +/, '');
	return { prefix, command, args, text: args.join(' '), rawText, cmd };
}

export const prefixConfig = () => config;
