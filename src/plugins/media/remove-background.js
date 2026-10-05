import { removeBackground, REMOVE_BACKGROUND_MODELS, REMOVE_BACKGROUND_ALIASES } from '#services/pixelyte.js';
import { runImageCommand, resolveModel } from './_shared.js';

/**
 * Remove an image background via the Pixelyte API.
 */
export default {
	commands: ['removebg', 'remove-bg', 'hd'],
	category: 'media',
	description: 'Remove an image background.',
	usage: '{prefix}removebg [model]',

	async run({ m, args }) {
		await runImageCommand({
			m,
			args,
			resolve: (input) => resolveModel(input, REMOVE_BACKGROUND_MODELS, REMOVE_BACKGROUND_ALIASES),
			usage:
				'Send an image with the caption *{prefix}removebg*, or reply to an image with *{prefix}removebg*.\n\n' +
				'Models (optional, empty = API default u2net):\n' +
				'• *{prefix}removebg u2netp* — fastest (~1s)\n' +
				'• *{prefix}removebg u2net* — balanced (~1.5s, default)\n' +
				'• *{prefix}removebg isnet* — best realistic quality (~5s)\n' +
				'• *{prefix}removebg birefnet* — most detailed (very slow, may fail)',
			react: '✂️',
			label: 'Remove background',
			run: (buffer, model) => removeBackground(buffer, { model, mime: m.msg?.mimetype }),
			caption: (meta) => `*Background removed* ✅\nModel: ${meta.model}\nProcessing time: ${meta.elapsed_seconds}s`,
		});
	},
};
