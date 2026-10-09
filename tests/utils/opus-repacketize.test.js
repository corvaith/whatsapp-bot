import { test, expect } from 'bun:test';
import { repacketizeOggOpusToCode3 } from '../../src/utils/media.js';

const FIXTURE_CODE0_B64 =
	'T2dnUwACAAAAAAAAAADRF8N4AAAAABrZBg4BE09wdXNIZWFkAQE4AYA+AAAAAABPZ2dTAAAAAAAAAAAAANEXw3gBAAAAKmrtQwE+T3B1c1RhZ3MNAAAATGF2ZjYwLjE2LjEwMAEAAAAdAAAAZW5jb2Rlcj1MYXZjNjAuMzEuMTAyIGxpYm9wdXNPZ2dTAAR4OQAAAAAAANEXw3gCAAAAUo0GDxBiLzIxLi8xLTAwMjIuLyokSIEXHsDRoWZDgg239q4j7Islgr8sDawhc1tUPpJ52sN/lZricaCsK74ObV0ATayeThFrbCi8fN0RQ7+gQn3pcpFMHz7pdrdBDwSaAyb07mD8CBH+/2EY/5Ajv3d2rAQo1IBInh53O+7mvuNvyHbXIFjzC9fw6ufUaPrHjdQjDgbLjeAGbw+dsws+30IlOkCAgEiZnWCUDj3hLRlFoRnFTbrC6nnd6T8Ic1Xu0hyYDGqGrJXNS2R3hgOwqD/azbC5ytzASJlJ0XVde452NkOYBQW4VQTaAE0xhK7t1MmHBp9YC/QuQ1N78inXeL91H0ZnQ9b3YEiZSdF1XXuAZN1ieKhSnbn2yKTRjbmAOrNp6USGmqUEYN1RKRgWVemWJacGz/BImUnRdV18lw6HWGFeNIEH+CyT27cW+9BAla0x3mbR+pWMJv5KkEZjayPz1aufgEiZSdF1XXxkEGZxJLtViHlHZYuNjqfIao5Z8kpf16Sa99bSSpIs+ceI8ApRpx4P7XBImUnSVtVXEC3yyATWY9V4Alm0o0/AtERLdZMYGWgwewOl8YO1vqWP0EDTSN5ImUnRdV17jnZAFEvgN0hb+Muj5oCBmOD4/tpKlBffFwlo699BH+m/FThv38V4r6hImUnRdV17gGT/PK2rwVCTVQx7vMXYv1PB400X3SvkKrp2XwZF3+eV5pVRPE2PREtImUnRdV18Wlr1hHgq8ApDJGi21HenekHDa1xNzJJW6mYssPFSNO6ZjwIDkmgFf9ubqEiZSdF1XXxiA85694XMm4E/NrQkJXE35J6XtC5yt5xv3KOlBGaXj/hdaNsrnBe9B6KASJlJ0lbVXI9iqe8CLSg/h1wcg3LqFJ0Huh0bYwJYDR0nD+bvqmWRbiM3yLxO9EiZSdF1XXuSEHfye17dfIMP6wky9BRLxmDai01yxEgYQPPLYs8LQvvYr8h+FMqASJlJ0XVde4CpWCheJ+Xvv983rkBzzxIXtgo1Xme/uOGTwJfGMSLWfJmASAVzBzhnxH0AtZdPyeuCMN4q/IcCWV97yezvZckiK4I4rUnk';

const firstAudioToc = (buf) => {
	let off = 0;
	let page = 0;
	while (off + 27 <= buf.length) {
		if (buf.toString('ascii', off, off + 4) !== 'OggS') break;
		const nseg = buf[off + 26];
		let dataOff = off + 27 + nseg;
		let dl = 0;
		for (let s = 0; s < nseg; s++) {
			dl += buf[off + 27 + s];
		}
		page++;
		if (page >= 3) {
			const toc = buf[dataOff];
			return { config: toc >> 3, code: toc & 0x03 };
		}
		off = dataOff + dl;
	}
	return null;
};

test('regroups code 0 frames into code 3 packets, preserving config + OpusHead', () => {
	const input = Buffer.from(FIXTURE_CODE0_B64, 'base64');
	expect(firstAudioToc(input)).toEqual({ config: 9, code: 0 });
	const out = repacketizeOggOpusToCode3(input);
	expect(out.subarray(0, 4).toString('ascii')).toBe('OggS');
	expect(out.includes(Buffer.from('OpusHead'))).toBe(true);
	expect(firstAudioToc(out)).toEqual({ config: 9, code: 3 });
});

test('is idempotent (already code 3 stays unchanged)', () => {
	const input = Buffer.from(FIXTURE_CODE0_B64, 'base64');
	const once = repacketizeOggOpusToCode3(input);
	const twice = repacketizeOggOpusToCode3(once);
	expect(twice.equals(once)).toBe(true);
});

test('returns non-OGG input untouched', () => {
	const junk = Buffer.from('this is not an ogg stream');
	expect(repacketizeOggOpusToCode3(junk)).toBe(junk);
});
