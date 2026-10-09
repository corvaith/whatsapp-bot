import { lookup } from 'dns/promises';
import { isIP } from 'net';

const BLOCKED_HOSTNAMES = new Set(['metadata.google.internal']);

function isPrivateIPv4(ip) {
	const parts = ip.split('.').map(Number);
	if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
	const [a, b] = parts;
	if (a === 0 || a === 10 || a === 127) return true;
	if (a === 169 && b === 254) return true;
	if (a === 172 && b >= 16 && b <= 31) return true;
	if (a === 192 && b === 168) return true;
	if (a === 100 && b >= 64 && b <= 127) return true;
	return false;
}

function isPrivateIPv6(ip) {
	const lower = ip
		.toLowerCase()
		.replace(/^\[|\]$/g, '')
		.split('%')[0];
	if (lower === '::' || lower === '::1') return true;
	if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true;
	if (/^f[cd]/.test(lower)) return true;
	const tail = lower.split(':').pop();
	if (tail && isIP(tail) === 4 && isPrivateIPv4(tail)) return true;
	if (lower.startsWith('::ffff:') || /^::(?:\d+\.)/.test(lower)) {
		const v4 = lower.includes('ffff:') ? lower.slice(7) : lower.slice(2);
		if (isPrivateIPv4(v4)) return true;
	}
	return false;
}

function isPrivateIp(ip) {
	const v = isIP(ip);
	if (v === 4) return isPrivateIPv4(ip);
	if (v === 6) return isPrivateIPv6(ip);
	return true;
}

/**
 * Validate an outbound URL for non-owner use: only http/https and no
 * private/loopback/link-local targets. Returns an error string or undefined.
 * DNS rebinding between this check and the connection is a documented,
 * accepted limitation.
 * @param {string|URL} rawUrl
 */
export async function guardUrl(rawUrl) {
	let url;
	try {
		url = new URL(rawUrl);
	} catch {
		return 'Invalid URL.';
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'Only http and https URLs are allowed.';
	if (BLOCKED_HOSTNAMES.has(url.hostname.toLowerCase())) return 'This address is blocked.';

	const host = url.hostname.replace(/^\[|\]$/g, '');
	if (isIP(host)) {
		if (isPrivateIp(host)) return 'Requests to private/loopback addresses are not allowed.';
		return undefined;
	}
	try {
		const records = await lookup(host, { all: true, verbatim: true });
		if (!records.length) return 'Could not resolve host.';
		if (records.some((r) => isPrivateIp(r.address))) return 'Host resolves to a private/loopback address.';
	} catch {
		return 'Could not resolve host.';
	}
	return undefined;
}
