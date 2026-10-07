/**
 * .qc / .quote — quote sticker via the self-hosted quote-api
 * (github.com/corvaith/quote-api, POST /generate.webp).
 */
import { createSticker, isAnimated, writeExifWebp } from '#utils/sticker.js';
import { request } from '#utils/http.js';

const API_URL = process.env.QUOTE_API_URL || 'https://gage-beautiful-span-methods.trycloudflare.com/generate.webp';
const MAX_MEDIA_BYTES = 8 * 1024 * 1024;

async function avatarFor(conn, jid) {
	try {
		return await conn.profilePictureUrl(jid, 'image');
	} catch {
		return undefined;
	}
}

function textOf(msg, type) {
	return msg?.conversation || msg?.[type]?.text || msg?.[type]?.caption || '';
}

export default {
	commands: ['qc', 'quote', 'quotely'],
	category: 'media',
	description: 'Generate a quote sticker. Use without reply for your own text, or reply a message/media to quote it.',
	usage: '{prefix}qc <text>  |  reply a message with {prefix}qc [text]',
	react: '💫',

	async run(context) {
		const { m, conn, text } = context;
		try {
			await conn.sendPresenceUpdate('composing', m.chat);

			const usingQuoted = m.isQuoted;
			const sourceJid = usingQuoted ? m.quoted.sender : m.sender;
			const sourceName = (usingQuoted ? m.quoted.pushName : m.pushname) || (usingQuoted ? 'User' : m.pushname) || 'User';
			const bodyText = (text || '').trim();

			// Media: quoted media wins, else own message media.
			// The API re-renders media small and squashed ("penyet"), so media quotes
			// bypass it entirely: sticker the buffer directly, framed by createSticker.
			let media = null;
			let mediaBuffer = null;
			let quotedIsMedia = false;
			if (usingQuoted && m.quoted.isMedia) {
				quotedIsMedia = true;
				mediaBuffer = await m.quoted.download();
			} else if (!usingQuoted && m.isMedia) {
				mediaBuffer = await m.download();
			}
			if (mediaBuffer && mediaBuffer.length <= MAX_MEDIA_BYTES) {
				const animated = isAnimated(mediaBuffer, m.quoted?.msg?.mimetype || m.msg?.mimetype || '');
				const sticker = await createSticker(mediaBuffer, { pack: 'whatsapp-bot', author: sourceName });
				await m.reply({ sticker, isAnimated: animated });
				await m.react('✅');
				return;
			}

			let replyMessage;
			if (usingQuoted && !quotedIsMedia) {
				const qCtx = m.quoted.msg?.contextInfo;
				if (qCtx?.quotedMessage) {
					const qKey = Object.keys(qCtx.quotedMessage)[0];
					const qMsg = qCtx.quotedMessage[qKey];
					const nestedJid = conn.getJid(qCtx.participant);
					replyMessage = {
						name: m.quoted.pushname || 'User',
						text: qMsg?.conversation || qMsg?.[qKey]?.text || qMsg?.[qKey]?.caption || '[media]',
						chatId: 2,
						from: { id: 2, name: m.quoted.pushname || 'User', photo: { url: await avatarFor(conn, nestedJid) } },
					};
				}
			}

			const msgText = quotedIsMedia ? '' : usingQuoted ? (bodyText || textOf(m.quoted.message, m.quoted.type)) : bodyText;
			if (!msgText) {
				await m.react('❌');
				return m.reply('No text or media to quote.\nUsage: .qc <text> or reply a message/media with .qc');
			}

			const photoUrl = await avatarFor(conn, sourceJid);
			const payload = {
				type: 'quote',
				format: 'webp',
				backgroundColor: bodyText.match(/#([0-9a-f]{6}|[0-9a-f]{3})\b/i)?.[0] || 'random',
				width: 512,
				height: 512,
				scale: 8,
				emojiBrand: 'apple',
				messages: [
					{
						from: { id: 1, name: sourceName, photo: photoUrl ? { url: photoUrl } : undefined },
						text: msgText.replace(/#([0-9a-f]{6}|[0-9a-f]{3})\s*/i, '') || undefined,
						avatar: !!photoUrl,
						...(replyMessage ? { replyMessage } : {}),
					},
				],
			};

			const res = await request({ url: API_URL, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), timeoutMs: 45000, maxBytes: MAX_MEDIA_BYTES });
			if (res.status !== 200) {
				let detail = '';
				try { detail = JSON.parse(res.buffer.toString()).error || ''; } catch {}
				throw new Error(`quote-api HTTP ${res.status}${detail ? `: ${detail}` : ''}`);
			}

			// quote-api output is already a well-framed sticker; only mux pack EXIF
			const sticker = await writeExifWebp(res.buffer, { pack: 'whatsapp-bot', author: sourceName });
			await m.reply({ sticker, isAnimated: false });
			await m.react('✅');
		} catch (err) {
			await m.react('❌');
			await m.reply(`QC failed: ${err.message?.slice(0, 200) || 'unexpected error.'}`);
		}
	},
};
