/**
 * Chat with the local Qwen2.5 1.5B Instruct model (llama.cpp, CPU).
 */
export default {
	commands: ['llm'],
	category: 'experimental',
	description: 'Ask the locally hosted AI model and reply with its answer.',
	usage: '{prefix}llm <question>',
	react: '🤔',

	async run({ m, text }) {
		const prompt = (text || '').trim();
		if (!prompt) return m.reply(`Usage: ${m.prefix}llm <question>`);

		try {
			const res = await fetch('http://127.0.0.1:3109/v1/chat/completions', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					model: 'local',
					messages: [
						{ role: 'system', content: 'Kamu asisten AI yang ramah dan menjawab singkat dalam bahasa Indonesia.' },
						{ role: 'user', content: prompt },
					],
					max_tokens: 400,
					temperature: 0.7,
				}),
				signal: AbortSignal.timeout(120_000),
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`);
			const reply = data.choices?.[0]?.message?.content?.trim();
			await m.react('✅');
			await m.reply(reply || '(empty reply)');
		} catch {
			await m.react('❌');
			await m.reply('The AI service is not available right now.');
		}
	},
};
