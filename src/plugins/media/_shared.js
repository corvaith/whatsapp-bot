export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** Image bytes from the quoted message, else from the message itself. */
export async function getImageBuffer(m) {
	if (m.isQuoted && m.quoted.isMedia && /^image\//i.test(m.quoted.msg?.mimetype || '')) return m.quoted.download();
	if (m.isMedia && /^image\//i.test(m.msg?.mimetype || '')) return m.download();
	return null;
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
