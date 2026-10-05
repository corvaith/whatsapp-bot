import { test, expect } from 'bun:test';
import { parseCommand, getPrefixes, validatePrefix, setRuntimePrefixes, DEFAULT_PREFIXES } from '../../src/core/prefix.js';

test('default: . ! / all match', () => {
	const a = parseCommand('.ping');
	expect(a.prefix).toBe('.');
	expect(a.command).toBe('ping');
	expect(a.cmd).toBe('.ping');
	const b = parseCommand('!ping args here');
	expect(b.prefix).toBe('!');
	expect(b.command).toBe('ping');
	const c = parseCommand('/ping');
	expect(c.prefix).toBe('/');
});

test('trigger bodies behave like the old parser', () => {
	// '>' is not in DEFAULT_PREFIXES → prefix stays ''
	const gt = parseCommand('> 1+1');
	expect(gt.prefix).toBe('');
	expect(gt.args).toEqual(['1+1']);
	// '=' is in DEFAULT_PREFIXES (old regex), so '=>' yields prefix '=' + command '>' exactly like before
	const eq = parseCommand('=> 3*3');
	expect(eq.prefix).toBe('=');
	expect(eq.command).toBe('>');
	const dollar = parseCommand('$ echo a');
	expect(dollar.prefix).toBe('');
	expect(dollar.args).toEqual(['echo', 'a']);
});

test('multi-char prefix wins over single char', () => {
	setRuntimePrefixes(['>>', '>']);
	const p = parseCommand('>>ping');
	expect(p.prefix).toBe('>>');
	expect(p.command).toBe('ping');
	setRuntimePrefixes(null);
});

test('rawText preserves spacing, args/text normalized', () => {
	const p = parseCommand('.fetch  {"a": 1,  "b": [2]}');
	expect(p.command).toBe('fetch');
	expect(p.rawText).toBe('{"a": 1,  "b": [2]}');
	expect(p.text).toBe('{"a": 1,  "b": [2]}'.split(/ +/).join(' '));
});

test('no matching prefix: fields computed like before', () => {
	const p = parseCommand('hello world');
	expect(p.prefix).toBe('');
	expect(p.command).toBe('hello');
	expect(p.args).toEqual(['world']);
});

test('validatePrefix rules', () => {
	expect(validatePrefix('>').ok).toBe(false);
	expect(validatePrefix('=>').ok).toBe(false);
	expect(validatePrefix('$').ok).toBe(false);
	expect(validatePrefix('ab').ok).toBe(false);
	expect(validatePrefix('!').ok).toBe(true);
	expect(validatePrefix('>>').ok).toBe(true);
	expect(validatePrefix('🍡').ok).toBe(true);
	expect(validatePrefix('a b').ok).toBe(false);
	expect(validatePrefix('!!!!!').ok).toBe(false);
});

test('PREFIX env overrides default', () => {
	process.env.PREFIX = '!';
	expect(getPrefixes()[0]).toBe('!');
	delete process.env.PREFIX;
	expect(getPrefixes()).toEqual(DEFAULT_PREFIXES);
});

test('runtime prefixes override env; longest first, dedup', () => {
	process.env.PREFIX = '.';
	setRuntimePrefixes(['>>', '.', '!', '.']);
	const list = getPrefixes();
	expect(list).toEqual(['>>', '.', '!']);
	setRuntimePrefixes(null);
	delete process.env.PREFIX;
});
