import crypto from 'crypto';
import { generateMessageIDV2, proto } from 'baileys';
/** Send a Meta AI style entity card built from AIRich compact-entity primitives. */

const section = (primitives, layout = 'GenAIActionRowLayoutViewModel') => ({
	view_model: { primitives, __typename: layout },
});

export const aicard = {
	commands: ['aicard'],
	category: 'experimental',
	description: 'Send a Meta AI style entity card. Bare send uses default artwork; attach/reply an image to override.',
	usage: '{prefix}aicard [Title | Subtitle | ImageURL | EntityURL | Text]',
	react: '🪪',

	async run(context) {
		const { m, conn, text } = context;
		const parts = (text || '').split('|').map((p) => p.trim());
		const title = parts[0] || 'whatsapp-bot';
		const subtitle = parts[1] || 'debug';
		const image = parts[2] || SQUARE_IMAGE;
		const entityUrl = parts[3] || 'https://github.com/corvaith';
		const body = parts[4];
		const username = entityUrl.replace(/\/+$/, '').split('/').pop() || title;

		const sections = [
			section([
				{
					title,
					subtitle: subtitle || '',
					secondary_subtitle: '',
					image: { url: image, mime_type: 'image/jpeg' },
					entity_id: '123456',
					entity_url: entityUrl,
					entity_type: 'WEBSITE',
					action_type: 'OPEN_URL',
					is_verified: true,
					__typename: 'GenAICompactEntityPrimitive',
				},
			]),
			section([{ type: 'HORIZONTAL_LINE', __typename: 'GenAIDividerPrimitive' }], 'GenAIVStackLayoutViewModel'),
			section([
				{ __typename: 'GenAISpacerPrimitive' },
				{
					text: `# {{social_entity_1}}${body || 'See results'}\0{{/social_entity_1}}    `,
					inline_entities: [
						{
							key: 'social_entity_1',
							metadata: {
								__typename: 'GenAISocialEntityItem',
								entity_id: username,
								entity_name: username,
								entity_full_name: title,
								entity_picture_url: image,
								entity_url: entityUrl,
								entity_type: 'IG_PROFILE',
								is_verified: true,
							},
						},
					],
					__typename: 'GenAIMarkdownTextUXPrimitive',
				},
				{ __typename: 'GenAISpacerPrimitive' },
			]),
		];

		await conn.relayMessage(
			m.chat,
			{
				botForwardedMessage: {
					message: {
						richResponseMessage: {
							messageType: proto.AIRichResponseMessageType.AI_RICH_RESPONSE_TYPE_STANDARD,
							submessages: [],
							unifiedResponse: {
								data: Buffer.from(JSON.stringify({ response_id: crypto.randomUUID(), sections })),
							},
							contextInfo: { isForwarded: true, forwardOrigin: 4 },
						},
					},
				},
			},
			{ messageId: generateMessageIDV2(conn.user?.id) },
		);
	},
};

/** Send a Meta AI style rich response: plain text, code block, table, or HTML app. */

const tokenize = (code, language) => {
	const keywords = new Set(
		(
			{
				javascript:
					'break case catch class const continue default delete do else export extends finally for function if import in instanceof let new return super switch this throw try typeof var void while yield async await null true false undefined',
				python: 'import from as def class return if elif else for while break continue try except finally raise with lambda pass del global and or not in is None True False async await self',
			}[language] || ''
		).split(' '),
	);
	const tokens = [];
	const push = (codeContent, highlightType) => {
		if (!codeContent) return;
		const last = tokens[tokens.length - 1];
		if (last && last.highlightType === highlightType) last.codeContent += codeContent;
		else tokens.push({ codeContent, highlightType });
	};
	let i = 0;
	while (i < code.length) {
		const c = code[i];
		if (/\s/.test(c)) {
			let s = i;
			while (i < code.length && /\s/.test(code[i])) i++;
			push(code.slice(s, i), 0);
			continue;
		}
		if (c === '/' && code[i + 1] === '/') {
			let s = i;
			while (i < code.length && code[i] !== '\n') i++;
			push(code.slice(s, i), 5);
			continue;
		}
		if (c === '#' && (language === 'python' || language === 'py')) {
			let s = i;
			while (i < code.length && code[i] !== '\n') i++;
			push(code.slice(s, i), 5);
			continue;
		}
		if (c === '"' || c === "'" || c === '`') {
			let s = i;
			const q = c;
			i++;
			while (i < code.length) {
				if (code[i] === '\\') i += 2;
				else if (code[i] === q) {
					i++;
					break;
				} else i++;
			}
			push(code.slice(s, i), 3);
			continue;
		}
		if (/[0-9]/.test(c)) {
			let s = i;
			while (i < code.length && /[0-9]/.test(code[i])) i++;
			push(code.slice(s, i), 4);
			continue;
		}
		if (/[a-zA-Z_$]/.test(c)) {
			let s = i;
			while (i < code.length && /[a-zA-Z0-9_$]/.test(code[i])) i++;
			const word = code.slice(s, i);
			push(word, keywords.has(word) ? 1 : 0);
			continue;
		}
		push(c, 0);
		i++;
	}
	return tokens;
};

const toTableRows = (table) => {
	const [head, ...rows] = table;
	return {
		rows: [{ items: head.map(String), isHeading: true }, ...rows.map((r) => ({ items: r.map(String) }))],
		unified_rows: [{ items: head.map(String), type: 'HEADER' }, ...rows.map((r) => ({ items: r.map(String), type: 'DEFAULT' }))],
	};
};

export const airich = {
	commands: ['airich'],
	category: 'experimental',
	description: 'Send a Meta AI style rich response: plain text, code block, table, or HTML mini app.',
	usage: '{prefix}airich <text> | code <lang> <code> | table "H1,H2;row1;row2"',
	react: '🤖',

	async run(context) {
		const { m, conn, text } = context;
		const raw = (text || '').trim() || 'Hello from the bot — this is a default rich response.';

		const submessages = [];
		const sections = [];
		let title = 'AI Response';

		if (raw.startsWith('html ')) {
			const html = raw.slice(5).trim().replace(/\\n/g, '\n');
			title = 'HTML App';
			sections.push({
				view_model: {
					primitive: {
						payload: html,
						trusted_sources: [],
						__typename: 'GenAIaeacdsnwHtmlPrimitive',
					},
					__typename: 'GenAISingleLayoutViewModel',
				},
			});
		} else if (raw.startsWith('code ')) {
			const body = raw.slice(5);
			const sp = body.indexOf(' ');
			const language = sp > 0 ? body.slice(0, sp) : 'javascript';
			const code = sp > 0 ? body.slice(sp + 1) : '';
			title = `Code — ${language}`;
			submessages.push({ messageType: 5, messageText: code });
			sections.push({
				view_model: {
					primitive: {
						language,
						code_blocks: tokenize(code, language).map((t) => ({
							content: t.codeContent,
							type: { 0: 'DEFAULT', 1: 'KEYWORD', 2: 'METHOD', 3: 'STR', 4: 'NUMBER', 5: 'COMMENT' }[t.highlightType],
						})),
						__typename: 'GenAICodeUXPrimitive',
					},
					__typename: 'GenAISingleLayoutViewModel',
				},
			});
		} else if (raw.startsWith('table ')) {
			const table = raw
				.slice(6)
				.split(';')
				.map((row) => row.split(',').map((c) => c.trim()));
			const meta = toTableRows(table);
			title = 'Table';
			submessages.push({ messageType: 4, tableMetadata: { rows: meta.rows } });
			sections.push({
				view_model: { primitive: { rows: meta.unified_rows, __typename: 'GenATableUXPrimitive' }, __typename: 'GenAISingleLayoutViewModel' },
			});
		} else {
			submessages.push({ messageType: 2, messageText: raw });
			sections.push({
				view_model: { primitive: { text: raw, inline_entities: [], __typename: 'GenAIMarkdownTextUXPrimitive' }, __typename: 'GenAISingleLayoutViewModel' },
			});
		}

		sections.push({
			view_model: {
				primitives: [
					{ prompt_text: 'Nice', prompt_type: 'SUGGESTED_PROMPT', __typename: 'GenAIFollowUpSuggestionPillPrimitive' },
					{ prompt_text: 'More info', prompt_type: 'SUGGESTED_PROMPT', __typename: 'GenAIFollowUpSuggestionPillPrimitive' },
				],
				__typename: 'GenAIActionRowLayoutViewModel',
			},
		});

		const content = {
			messageContextInfo: {
				deviceListMetadata: {},
				deviceListMetadataVersion: 2,
			},
			botForwardedMessage: {
				message: {
					richResponseMessage: {
						messageType: proto.AIRichResponseMessageType.AI_RICH_RESPONSE_TYPE_STANDARD,
						submessages,
						unifiedResponse: {
							data: Buffer.from(JSON.stringify({ response_id: crypto.randomUUID(), sections })),
						},
						contextInfo: { forwardingScore: 1, isForwarded: true, forwardOrigin: 4 },
					},
				},
			},
		};
		await conn.relayMessage(m.chat, content, { messageId: generateMessageIDV2() });
	},
};

export default [aicard, airich];
