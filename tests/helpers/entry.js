import { loadPlugins } from '../../src/core/plugins.js';

let ready;
let registry;

export async function getRegistry() {
	if (!ready) {
		ready = loadPlugins(undefined, new URL('../../src/plugins', import.meta.url).pathname);
		registry = await ready;
	}
	return registry;
}

export async function handle(conn, m) {
	registry ??= await getRegistry();
	const { handle: h } = await import('../../src/core/dispatcher.js');
	return h(conn, m, registry);
}
