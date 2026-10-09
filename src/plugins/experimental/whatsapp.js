import crypto from 'crypto';
import { execFile } from 'child_process';
import { generateWAMessageContent, generateWAMessageFromContent } from 'baileys';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { analyzeAudio, repacketizeOggOpusToCode3 } from '#utils/media.js';

/**
 * Get the group invite link.
 */
export const glink = {
	commands: ['glink', 'gclink'],
	category: 'experimental',
	description: 'Get this group invite link.',
	usage: '{prefix}glink',
	react: '🔗',

	async run(context) {
		const { m, conn } = context;
		if (!m.isGroup) return m.reply('Run this inside a group.');
		const code = await conn.groupInviteCode(m.chat);
		if (!code) return m.reply('Could not get the invite code (bot may not be admin).');
		await m.reply(`https://chat.whatsapp.com/${code}`);
	},
};

/**
 * Send a group invite card for the current group.
 */
export const ginvite = {
	commands: ['ginvite'],
	category: 'experimental',
	description: 'Send a group invite card. Usage: .ginvite [caption]',
	usage: '{prefix}ginvite [caption]',
	react: '📨',

	async run(context) {
		const { m, conn, text } = context;
		if (!m.isGroup) return m.reply('Run this inside a group.');
		const code = await conn.groupInviteCode(m.chat);
		if (!code) return m.reply('Could not get the group invite code.');
		const info = await conn.groupGetInviteInfo(code).catch(() => null);
		const [years, days] = [0, 7];
		const expires = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * days;
		void years;
		await m.reply({
			groupInvite: {
				inviteCode: code,
				inviteExpiration: expires,
				text: (text || '').trim() || 'Join this group',
				jid: m.chat,
				subject: info?.subject || 'Group',
			},
		});
	},
};

/**
 * .inapp — relay a hand-crafted native-flow interactive message whose content
 * also carries a sender-key distribution blob (verbatim from a working relay).
 */

const SENDER_KEY_BYTES = Uint8Array.from([
	51, 8, 218, 232, 141, 249, 7, 16, 7, 26, 32, 19, 239, 40, 201, 25, 239, 10, 132, 20, 1, 62, 11, 136, 190, 63, 198, 76, 165, 56, 58, 123, 119, 180, 110, 138, 105, 180, 141, 81, 212, 235, 86, 34,
	33, 5, 125, 79, 176, 6, 62, 37, 125, 58, 100, 247, 47, 228, 32, 17, 41, 184, 117, 68, 234, 67, 120, 213, 5, 61, 150, 167, 7, 93, 142, 94, 174, 40,
]);

const json = (o) => JSON.stringify(o);

export const inapp = {
	commands: ['inapp'],
	category: 'experimental',
	description: 'Relay a hand-crafted native-flow interactive message.',
	usage: '{prefix}inapp',

	async run({ m, conn }) {
		await conn.relayMessage(
			m.chat,
			{
				senderKeyDistributionMessage: {
					groupId: '120363423077197619@g.us',
					axolotlSenderKeyDistributionMessage: SENDER_KEY_BYTES,
				},
				interactiveMessage: {
					header: { title: 'Hello World!', hasMediaAttachment: false },
					body: { text: 'Hello World!' },
					contextInfo: {
						participant: '13135550002@s.whatsapp.net',
						remoteJid: 'status@broadcast',
					},
					nativeFlowMessage: {
						buttons: [{ name: 'inapp_signup', buttonParamsJson: json({}) }],
					},
				},
			},
			{
				additionalNodes: [
					{
						tag: 'biz',
						attrs: {},
						content: [
							{
								tag: 'interactive',
								attrs: { type: 'native_flow', v: '1' },
								content: [{ tag: 'native_flow', attrs: { v: '9', name: 'mixed' } }],
							},
						],
					},
				],
			},
		);
	},
};

/**
 * Post a group story (groupStatusMessageV2): text, image, video, or audio.
 * Audio is converted to opus ptt so it can be played from the story.
 */

export const grupstory = {
	commands: ['grupstory', 'gstory'],
	category: 'experimental',
	description: 'Post a story visible only in this group. Attach media with caption, or .grupstory <text>.',
	usage: '{prefix}grupstory <text> | (attach image/video/audio with this as caption)',
	react: 'story',

	async run(context) {
		const { m, conn, quoted, text, downloadMedia } = context;
		const source = m.isQuoted ? m.quoted : m;
		const mime = source?.msg?.mimetype || '';

		let content;
		let audioMeta;
		if (source?.isMedia && mime.startsWith('audio/')) {
			const buffer = await downloadMedia();
			const dir = await mkdtemp(join(tmpdir(), 'gstory-'));
			try {
				const input = join(dir, 'in');
				const output = join(dir, 'out.ogg');
				await writeFile(input, buffer);
				await new Promise((resolve, reject) => {
					execFile('ffmpeg', ['-y', '-i', input, '-avoid_negative_ts', 'make_zero', '-ac', '1', '-c:a', 'libopus', output], { timeout: 60000 }, (err) => (err ? reject(err) : resolve()));
				});
				const playable = repacketizeOggOpusToCode3(await readFile(output));
				audioMeta = await analyzeAudio(playable);
				content = { audio: playable, mimetype: 'audio/ogg; codecs=opus', ptt: true };
			} finally {
				await rm(dir, { recursive: true, force: true });
			}
		} else if (source?.isMedia && mime.startsWith('video/')) {
			content = { video: await downloadMedia(), caption: (text || '').trim() || undefined };
		} else if (source?.isMedia && mime.startsWith('image/')) {
			content = { image: await downloadMedia(), caption: (text || '').trim() || undefined };
		} else if (text && text.trim()) {
			content = { text: text.trim() };
		} else {
			return m.reply(
				`How to use:\n- ${m.prefix}grupstory <text> for a text story\n- Attach an image/video/audio with ${m.prefix}grupstory as caption (or reply to one)\n- Audio is auto-converted to voice note so it can be played`,
			);
		}

		const inner = await generateWAMessageContent(content, {
			processMedia: async (buf, mediaType, waClient) => ({
				upload: waClient ? await waClient.uploadMedia(buf, mediaType) : await conn.waUploadToServer(buf, { mediaType }),
				metadata: mediaType === 'audio' ? audioMeta : undefined,
			}),
		});
		const messageSecret = crypto.randomBytes(32);
		const wrapped = generateWAMessageFromContent(
			m.chat,
			{
				messageContextInfo: { messageSecret },
				groupStatusMessageV2: { message: { ...inner, messageContextInfo: { messageSecret } } },
			},
			{ userJid: conn.user.id },
		);
		await conn.relayMessage(m.chat, wrapped.message, { messageId: wrapped.key.id });
	},
};

/**
 * Create a WhatsApp event card (starts 5 minutes from now).
 */
export const event = {
	commands: ['event'],
	category: 'experimental',
	description: 'Create an event starting in 5 minutes. Usage: .event <name> | [description]',
	usage: '{prefix}event <name> | [description]',
	react: '📅',

	async run(context) {
		const { m, text } = context;
		const parts = (text || '').split('|').map((s) => s.trim());
		const name = parts[0];
		if (!name) return m.reply(`Usage: ${m.prefix}event <name> | [description]`);
		const now = new Date();
		await m.reply({
			event: {
				name,
				description: parts[1] || undefined,
				startDate: new Date(now.getTime() + 5 * 60 * 1000),
				endDate: new Date(now.getTime() + 2 * 60 * 60 * 1000),
				isCancelled: false,
				extraGuestsAllowed: true,
			},
		});
	},
};

export default [glink, ginvite, inapp, grupstory, event];
