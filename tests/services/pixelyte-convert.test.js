import { test, expect, mock } from 'bun:test';

process.env.PIXELYTE_API_URL ??= 'https://pixelyte-mock.local';
const realFetch = globalThis.fetch;

test('convert(Buffer) sends multipart with custom filename & to; convert({url}) sends JSON', async () => {
	const calls = [];
	globalThis.fetch = async (input, init) => {
		calls.push({ url: String(input), init });
		return new Response(JSON.stringify({ success: true, data: { url: 'https://pixelyte-mock.local/results/r.bin', filename: 'r.bin', from: 'mp4', to: 'mp3' } }), {
			status: 200,
			headers: { 'content-type': 'application/json' },
		});
	};
	try {
		const { convert } = await import('../../src/services/pixelyte.js');
		await convert(Buffer.from('xx'), { to: 'mp3', filename: 'upload.mp4', timeoutMs: 5000, maxOutputBytes: 1024 });
		expect(calls[0].url).toEndWith('/api/convert');
		expect(calls[0].init.body instanceof FormData).toBe(true);
		expect(calls[0].init.body.get('to')).toBe('mp3');

		await convert({ url: 'https://host.local/a.mp4' }, { to: 'mp3' });
		expect(calls[2].url).toEndWith('/api/convert');
		expect(calls[2].init.headers['content-type']).toBe('application/json');
		expect(JSON.parse(calls[2].init.body)).toEqual({ url: 'https://host.local/a.mp4', to: 'mp3' });
	} finally {
		globalThis.fetch = realFetch;
	}
});

test('convert error envelope → PixelyteError with API message', async () => {
	globalThis.fetch = async () =>
		new Response(JSON.stringify({ success: false, error: { code: 'NO_AUDIO_TRACK', message: 'The source file has no audio track to extract.' } }), {
			status: 400,
			headers: { 'content-type': 'application/json' },
		});
	try {
		const { convert, PixelyteError } = await import('../../src/services/pixelyte.js');
		const err = await convert(Buffer.from('xx'), { to: 'mp3' }).catch((e) => e);
		expect(err instanceof PixelyteError).toBe(true);
		expect(err.message).toContain('no audio track');
	} finally {
		globalThis.fetch = realFetch;
	}
});
