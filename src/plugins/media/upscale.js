import { upscale, UPSCALE_MODELS, UPSCALE_ALIASES } from '#services/pixelyte.js';
import { runImageCommand, resolveModel } from './_shared.js';

/**
 * Upscale an image 4x via the Pixelyte API.
 */
export default {
	commands: ['upscale', 'hd', 'hdr'],
	category: 'media',
	description: 'Upscale an image.',
	usage: '{prefix}upscale [model]',

	async run({ m, args }) {
		await runImageCommand({
			m,
			args,
			resolve: (input) => resolveModel(input, UPSCALE_MODELS, UPSCALE_ALIASES),
			usage:
				'Send an image with the caption *{prefix}upscale*, or reply to an image with *{prefix}upscale*.\n\n' +
				'Models (optional, empty = API default):\n' +
				'• *{prefix}upscale* — fast (~2s)\n' +
				'• *{prefix}upscale x4plus* — maximum detail (~25s)\n' +
				'• *{prefix}upscale swinir* — smooth, natural result',
			react: '🔎',
			label: 'Upscale',
			run: (buffer, model) => upscale(buffer, { model, mime: m.msg?.mimetype }),
			caption: (meta) =>
				`*Upscale completed* ✅\nModel: ${meta.model}\nSize: ${meta.input_width}x${meta.input_height} → ${meta.output_width}x${meta.output_height}\nProcessing time: ${meta.elapsed_seconds}s`,
		});
	},
};
