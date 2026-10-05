export function randomItem(items) {
	if (!items || items.length === 0) return undefined;
	const randomIndex = Math.floor(Math.random() * items.length);
	return items[randomIndex];
}

export function formatSize(bytes) {
	if (bytes === 0) return '0 B';

	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	const i = Math.floor(Math.log(bytes) / Math.log(1024));

	return `${(bytes / 1024 ** i).toFixed(2)} ${units[i]}`;
}

export function toTime(ms) {
	let d = Math.floor(ms / 86400000);
	let h = Math.floor((ms % 86400000) / 3600000);
	let m = Math.floor((ms % 3600000) / 60000);
	let s = Math.floor((ms % 60000) / 1000);

	return (d ? `${d}d ` : '') + (h ? `${h}h ` : '') + (m ? `${m}m ` : '') + (s ? `${s}s` : '');
}

export const toLocalDate = (date) => new Date(date).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });

/** Truncate long text with a visible marker. */
export function truncate(text, max = 65536) {
	return text.length <= max ? text : `${text.slice(0, max)}\n\n_(truncated)_`;
}

/** Replace {prefix} placeholders in a plugin usage string. */
export function renderUsage(usage, prefix) {
	return String(usage).replaceAll('{prefix}', prefix);
}
