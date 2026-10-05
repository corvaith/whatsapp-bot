import chalk from 'chalk';

const LEVELS = {
	trace: 10,
	debug: 20,
	info: 30,
	warn: 40,
	error: 50,
	fatal: 60,
	silent: Infinity,
};

const LEVEL_SYMBOLS = {
	trace: '◌',
	debug: '●',
	info: 'ℹ',
	warn: '⚠',
	error: '✖',
	fatal: '☠',
	silent: '·',
};

const LEVEL_COLORS = {
	trace: chalk.hex('#9ca3af'),
	debug: chalk.hex('#22d3ee').bold,
	info: chalk.hex('#4ade80').bold,
	warn: chalk.hex('#facc15').bold,
	error: chalk.hex('#fb7185').bold,
	fatal: chalk.bgHex('#dc2626').whiteBright.bold,
	silent: chalk.gray,
};

const K = chalk.hex('#67e8f9'); // key
const S = chalk.green; // string
const N = chalk.yellow; // number
const B = chalk.magenta; // boolean / null
const P = chalk.hex('#94a3b8'); // punctuation

function prettyValue(value, depth, seen) {
	const indent = '  '.repeat(depth);
	const pad = '  '.repeat(depth + 1);
	const colSep = ',';
	let out = '';

	if (value === null) return B('null');
	if (Array.isArray(value)) {
		if (seen.has(value)) return chalk.red('[Circular]');
		if (value.length === 0) return P('[]');
		seen.add(value);
		out += P('[');
		value.forEach((v, i) => {
			if (v !== undefined) {
				out += `\n${pad}${prettyValue(v, depth + 1, seen)}${i < value.length - 1 ? P(colSep) : ''}`;
			}
		});
		out += `\n${indent}${P(']')}`;
		seen.delete(value);
		return out;
	}
	if (typeof value === 'object') {
		if (seen.has(value)) return chalk.red('[Circular]');
		const keys = Object.keys(value);
		if (keys.length === 0) return P('{}');
		seen.add(value);
		out += P('{');
		keys.forEach((key, i) => {
			const v = value[key];
			if (v === undefined) return;
			out += `\n${pad}${K(key)}${P(': ')}${prettyValue(v, depth + 1, seen)}${i < keys.length - 1 ? P(colSep) : ''}`;
		});
		out += `\n${indent}${P('}')}`;
		seen.delete(value);
		return out;
	}
	switch (typeof value) {
		case 'string':
			return S(JSON.stringify(value));
		case 'number':
		case 'bigint':
			return N(String(value));
		case 'boolean':
			return B(String(value));
		case 'undefined':
			return chalk.gray('undefined');
		default:
			return chalk.gray(String(value));
	}
}

function formatArg(arg, depth = 0, seen = null) {
	seen ??= new Set();
	if (arg instanceof Error) {
		const rest = arg.stack ? arg.stack.split('\n').slice(1).join('\n') : '';
		const where = rest ? `\n${'  '.repeat(depth + 1)}${rest}` : '';
		let err = `${chalk.hex('#fb7185').bold(`${arg.name}: ${arg.message}`)}${chalk.hex('#fb7185').dim(where)}`;
		if (arg.cause) err += `\n${'  '.repeat(depth + 1)}${chalk.gray('cause:')} ${formatArg(arg.cause, depth + 1, seen)}`;
		return err;
	}
	if (typeof arg === 'object' && arg !== null) {
		try {
			return prettyValue(arg, depth, seen);
		} catch {
			return chalk.gray(String(arg));
		}
	}
	if (arg === undefined) return '';
	return String(arg);
}

function formatArgs(args) {
	return args
		.map((a) => formatArg(a))
		.filter((s) => s !== '')
		.join(' ');
}

export function createChalkLogger({ level = 'info', prefix = '' } = {}) {
	const isEnabled = level === 'silent' ? () => false : (method) => (LEVELS[method] ?? 99) >= LEVELS[level];

	const make =
		(method) =>
		(...args) => {
			if (!isEnabled(method)) return;
			const time = chalk.hex('#64748b').dim(new Date().toLocaleTimeString('id-ID', { hour12: false }));
			const tag = LEVEL_COLORS[method](` ${LEVEL_SYMBOLS[method]} ${method.toUpperCase().padEnd(4)} `);
			const label = prefix ? `${chalk.hex('#c084fc').bold(prefix)}` : '';
			console.log(`${time} ${tag} ${label} ${formatArgs(args)}`.trimEnd());
		};

	return {
		level,
		levelVal: LEVELS[level],
		msgPrefix: prefix,
		levels: { values: LEVELS, labels: {} },
		trace: make('trace'),
		debug: make('debug'),
		info: make('info'),
		warn: make('warn'),
		error: make('error'),
		fatal: make('fatal'),
		silent: () => {},
		time(label) {
			const start = Date.now();
			return {
				start,
				end: (outLevel = 'debug', minMs = 0) => {
					const ms = Date.now() - start;
					if (ms >= minMs) make(outLevel)(`${label} ${ms} ms`);
					return ms;
				},
			};
		},
		flush() {},
		bindings() {
			return {};
		},
		setBindings() {},
		onChild() {},
		isLevelEnabled(method) {
			return isEnabled(method);
		},
		child(bindings = {}, options = {}) {
			const nextPrefix = [prefix, options.msgPrefix ?? bindings.msgPrefix ?? ''].filter(Boolean).join('·');
			return createChalkLogger({ level: options.level ?? level, prefix: nextPrefix });
		},
	};
}

export default createChalkLogger({ level: 'info' });
