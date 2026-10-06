import { ocr, OCR_LANGUAGES } from '#services/pixelyte.js';
import { getImageBuffer } from './_shared.js';

/**
 * Extract text from an image via the Pixelyte API.
 */
export default {
	commands: ['ocr'],
	category: 'media',
	description: 'Extract text from an image.',
	usage: '{prefix}ocr [language]',
	react: '📄',

	async run({ m, args, prefix }) {
		const language = args[0]?.toLowerCase();
		if (language && !OCR_LANGUAGES.includes(language)) {
			return m.reply(
				`Unsupported OCR language: *${args[0]}*\n\nValid options:\n• latin (default — any Latin-script language)\n• chinese`
			);
		}

		const buffer = await getImageBuffer(m);
		if (!buffer) {
			return m.reply(
				'Send an image with the caption *' + prefix + 'ocr*, or reply to an image with *' + prefix + 'ocr*.\n\n' +
					'Languages (optional, empty = latin):\n• *' + prefix + 'ocr* — Latin script\n• *' + prefix + 'ocr chinese* — Chinese text'
			);
		}

		const startedAt = Date.now();
		try {
			const data = await ocr(buffer, { language, mime: m.msg?.mimetype });
			const lines = data.lines || [];
			const confidence =
				lines.length > 0 ? (lines.reduce((sum, line) => sum + (line.confidence || 0), 0) / lines.length).toFixed(2) : '0';

			if (!data.text?.trim()) {
				await m.react('🤷');
				return m.reply('OCR failed: no readable text was detected.');
			}

			await m.reply(
				`*OCR result* 🔍\n\n${data.text}\n\n` +
					`— ${lines.length} lines, average confidence ${confidence}\n` +
					`Processing time: ${((Date.now() - startedAt) / 1000).toFixed(1)}s`
			);
			await m.react('✅');
		} catch (err) {
			await m.react('❌');
			await m.reply('OCR failed: the service is unavailable or the image could not be processed.');
		}
	},
};
