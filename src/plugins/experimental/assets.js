/**
 * Fallback artwork for experimental commands that need an image but were not
 * given one, so a bare command still renders a complete card.
 */

import { request } from '#utils/http.js';
import { getMediaBuffer } from '#plugins/media/mediaHelpers.js';

/** Square artwork (entity/profile style). */
export const SQUARE_IMAGE = 'https://lunee.lol/d/Q1OdEg2a.jpg';
/** Wide artwork (banner/cover style). */
export const BANNER_IMAGE = 'https://lunee.lol/d/ihyV3KoH.jpg';

/** Image bytes from the reply/attachment, else downloaded from the fallback URL. */
export async function resolveMedia(m, fallbackUrl, { maxBytes = 8 * 1024 * 1024, timeoutMs = 20000 } = {}) {
	const local = await getMediaBuffer(m);
	if (local?.buffer?.length) return local;
	try {
		const res = await request({ url: fallbackUrl, timeoutMs, maxBytes });
		if (res.status !== 200) return null;
		const mime = res.headers.find(([k]) => k.toLowerCase() === 'content-type')?.[1] || 'image/jpeg';
		return { buffer: res.buffer, mime };
	} catch {
		return null;
	}
}
