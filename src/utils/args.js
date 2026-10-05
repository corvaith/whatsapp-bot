/**
 * Tokenizer for command arguments: whitespace-separated, aware of single,
 * double and smart quotes; smart quotes normalize to ASCII first.
 * @param {string} input
 * @returns {string[]}
 */
export function tokenize(input) {
	const normalized = String(input ?? '')
		.replace(/[“”]/g, '"')
		.replace(/[‘’]/g, "'");
	const tokens = [];
	let current = '';
	let quote = null;
	for (const ch of normalized) {
		if (quote) {
			if (ch === quote) quote = null;
			else current += ch;
		} else if (ch === '"' || ch === "'") {
			quote = ch;
		} else if (/\s/.test(ch)) {
			if (current) tokens.push(current);
			current = '';
		} else {
			current += ch;
		}
	}
	if (current) tokens.push(current);
	return tokens;
}

/**
 * Split a token into option name and inline value: --method=POST → ['method', 'POST'].
 * @returns {[string, string|undefined]}
 */
export function splitOption(token) {
	const match = /^(--?[^=]+)=(.*)$/.exec(token);
	return match ? [match[1], match[2]] : [token, undefined];
}
