import { renderUsage } from '#utils/format.js';
import { PixelyteError } from '#services/pixelyte.js';

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** Image bytes from the quoted message, else from the message itself. */
export async function getImageBuffer(m) {
	if (m.isQuoted && m.quoted.isMedia && /^image\//i.test(m.quoted.msg?.mimetype || '')) return m.quoted.download();
	if (m.isMedia && /^image\//i.test(m.msg?.mimetype || '')) return m.download();
	return null;
}

/** Match a user-supplied model name against the API allowlist. */
export function resolveModel(input, models, aliases) {
	if (!input) return { value: undefined };
	const key = input.toLowerCase().replace(/^\.+/, '').trim();
	const known = models.find((model) => model.toLowerCase() === key) || aliases[key];
	if (!known) {
		const list = models.map((model) => `• ${model}`).join('\n');
		return { error: `Unknown model: *${input}*\n\nValid options:\n${list}\n\nLeave empty to use the API default.` };
	}
	return { value: known };
}

/**
 * Shared flow for single-image commands: resolve the model, fetch the image,
 * call the service, reply with the result.
 * @param {{m: any, args: string[], resolve: (input?: string) => {value?: string, error?: string}, usage: string, react: string,
 *   run: (buffer: Buffer, model?: string) => Promise<{buffer: Buffer, meta: any}>, caption: (meta: any) => string, label: string}} options
 */
export async function runImageCommand({ m, args, resolve, usage, react, run, caption, label }) {
	const pick = resolve(args[0]);
	if (pick.error) return m.reply(pick.error);

	const buffer = await getImageBuffer(m);
	if (!buffer) return m.reply(renderUsage(usage, m.prefix || '.'));
	if (buffer.length > MAX_IMAGE_BYTES) {
		await m.react('❌');
		return m.reply(`Image is too large (${(buffer.length / 1048576).toFixed(1)} MB); the limit is 10 MB.`);
	}

	await m.react(react);
	try {
		const { buffer: result, meta } = await run(buffer, pick.value);
		await m.reply({ image: result, caption: caption(meta) });
		await m.react('✅');
	} catch (err) {
		await m.react('❌');
		const detail = err instanceof PixelyteError ? err.message : 'unexpected processing error';
		await m.reply(`${label} failed: ${detail}`);
	}
}

/** Any-media bytes from the quoted message, else from the message itself. */
export async function getMediaBuffer(m) {
	if (m.isQuoted && m.quoted.isMedia) {
		return { buffer: await m.quoted.download(), mime: m.quoted.msg?.mimetype };
	}
	if (m.isMedia) {
		return { buffer: await m.download(), mime: m.msg?.mimetype };
	}
	return null;
}
