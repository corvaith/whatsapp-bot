import { test, expect, beforeEach, afterAll } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PluginRegistry } from '../../src/core/plugin-registry.js';
import { loadPlugins, hotReload } from '../../src/core/plugin-loader.js';

let dir;
let cwd;
beforeEach(() => {
	cwd ??= process.cwd();
	dir = mkdtempSync(join(tmpdir(), 'plugins-'));
	mkdirSync(join(dir, 'plugins/general'), { recursive: true });
	process.chdir(dir);
});
afterAll(() => process.chdir(cwd));

const write = (rel, code) => {
	const p = join(dir, 'plugins', rel);
	mkdirSync(join(p, '..'), { recursive: true });
	writeFileSync(p, code);
	return p;
};

test('loadPlugins: discovery + findCommand case-insensitive', async () => {
	write('general/ping.js', 'export default { commands:["ping"], description:"d", run(){} }');
	const registry = await loadPlugins(undefined, join(dir, 'plugins'));
	expect(registry.findCommand('PING')?.commands).toEqual(['ping']);
	expect(registry.findCommand('missing')).toBeUndefined();
});

test('duplicate command: registration fails with both files', async () => {
	write('general/a.js', 'export default { commands:["ping"], description:"d", run(){} }');
	write('general/b.js', 'export default { commands:["ping"], description:"d2", run(){} }');
	await expect(loadPlugins(undefined, join(dir, 'plugins'))).rejects.toThrow(/already registered/);
});

test('validation: commands + match together rejected; missing run rejected', async () => {
	write('general/bad.js', 'export default { commands:["x"], match: () => true, description:"d", run(){} }');
	await expect(loadPlugins(undefined, join(dir, 'plugins'))).rejects.toThrow(/exactly one/);

	rmSync(join(dir, 'plugins/general/bad.js'));
	write('general/bad2.js', 'export default { commands:["y"], description:"d" }');
	await expect(loadPlugins(undefined, join(dir, 'plugins'))).rejects.toThrow(/Missing required field: run/);

	rmSync(join(dir, 'plugins/general/bad2.js'));
	write('general/bad3.js', 'export default { commands:["z"] }');
	await expect(loadPlugins(undefined, join(dir, 'plugins'))).rejects.toThrow(/Missing required field: description/);
});

test('hot reload: change, add, remove; failed syntax keeps previous version', async () => {
	const p = write('general/ping.js', 'export default { commands:["ping"], description:"d", run(){} }');
	const registry = await loadPlugins(undefined, join(dir, 'plugins'));
	expect(registry.findCommand('ping')).toBeTruthy();

	// change command (mtime must differ)
	writeFileSync(p, 'export default { commands:["pong"], description:"d", run(){} }');
	utimesSync(p, new Date(Date.now() + 5000), new Date(Date.now() + 5000));
	hotReload.lastCheck = 0;
	await hotReload(registry, join(dir, 'plugins'));
	expect(registry.findCommand('ping')).toBeUndefined();
	expect(registry.findCommand('pong')).toBeTruthy();

	// syntax error keeps previous version
	utimesSync(p, new Date(Date.now() + 6000), new Date(Date.now() + 6000));
	writeFileSync(p, 'export default { commands: [broken');
	const before = registry.findCommand('pong');
	hotReload.lastCheck = 0;
	await hotReload(registry, join(dir, 'plugins'));
	expect(registry.findCommand('pong')).toBe(before);

	// delete file
	rmSync(p);
	hotReload.lastCheck = 0;
	await hotReload(registry, join(dir, 'plugins'));
	expect(registry.findCommand('pong')).toBeUndefined();
});

test('help auto-discovers a newly added plugin', async () => {
	write('general/ping.js', 'export default { commands:["ping"], description:"d", run(){} }');
	const registry = await loadPlugins(undefined, join(dir, 'plugins'));
	let groups = registry.getVisibleCommands({ isOwner: false });
	expect(groups.get('general').some((c) => c.name === 'ping')).toBe(true);

	// add compress.js -> appears without code changes
	const p = write('media/compress.js', 'export default { commands:["compress"], category:"media", description:"Compress media.", run(){} }');
	registry.replace(p, (await import(`${p}?t=${Date.now()}`)).default, 1);
	groups = registry.getVisibleCommands({ isOwner: false });
	expect(groups.get('media').some((c) => c.name === 'compress')).toBe(true);
});

test('registry: aliases grouped, owner commands hidden from non-owners', async () => {
	write('general/a.js', 'export default { commands:["removebg","remove-bg","hd"], category:"media", description:"Remove an image background.", run(){} }');
	write('owner/e.js', 'export default { commands:["exec"], category:"owner", description:"Shell.", access:"owner", run(){} }');
	const registry = await loadPlugins(undefined, join(dir, 'plugins'));

	const ownerView = registry.getVisibleCommands({ isOwner: true });
	expect(ownerView.get('media')[0].aliases).toEqual(['remove-bg', 'hd']);
	expect(ownerView.get('owner').length).toBe(1);

	const userView = registry.getVisibleCommands({ isOwner: false });
	expect(userView.has('owner')).toBe(false);
	expect(userView.get('media')[0].name).toBe('removebg');
});
