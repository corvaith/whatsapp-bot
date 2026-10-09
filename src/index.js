import { config, validateConfig } from './config.js';
import { loadPlugins } from './app/plugins.js';
import { startBot } from './app/bot.js';

validateConfig();

const registry = await loadPlugins();
console.log(`INFO  Starting WhatsApp bot`);
console.log(`INFO  Environment: ${config.env}`);
console.log(`INFO  Loaded ${registry.getCommands().length} plugins`);

startBot(registry);

process.on('unhandledRejection', (reason) => {
	console.error('Unhandled rejection:', reason);
});

process.on('uncaughtException', (err) => {
	console.error('Uncaught exception:', err);
});
