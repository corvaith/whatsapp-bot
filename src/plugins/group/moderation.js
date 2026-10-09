/**
 * Group moderation: kick, promote and demote with guard + pre-flight target
 * validation (membership, current role) before the participant API call.
 */
import { RESPONSES } from '#config.js';
import { isSenderAdmin, isBotAdmin, invalidateGroupMeta, validateTarget, resolveTarget } from '#services/groupAdmin.js';

/** Guard order: group chat, sender admin, bot admin. */
export async function moderationGuard(conn, m) {
	if (!m.isGroup) return RESPONSES.groupOnly;
	if (!(await isSenderAdmin(conn, m))) return RESPONSES.notAdmin;
	if (!(await isBotAdmin(conn, m))) return RESPONSES.botNotAdmin;
	return undefined;
}

/** Pre-flight checks per action so a stale command fails with a clear reply. */
const TARGET_CHECKS = {
	remove: ['notInGroup'],
	promote: ['notInGroup', 'alreadyAdmin'],
	demote: ['notInGroup', 'targetNotAdmin'],
};

/** Run a participant update and drop the metadata cache so admin checks stay fresh. */
export async function applyParticipantChange(conn, chat, target, action) {
	const result = await conn.groupParticipantsUpdate(chat, [target], action);
	invalidateGroupMeta(chat);
	return result;
}

/** Shared flow: guard → resolve target → validate → apply → reply. */
export async function runParticipantCommand({ m, conn, args }, action, usage) {
	const guard = await moderationGuard(conn, m);
	if (guard) return m.reply(guard);

	const target = resolveTarget(m, args);
	if (!target) return m.reply(RESPONSES.noTarget.replace('{usage}', usage));

	for (const reason of TARGET_CHECKS[action]) {
		if ((await validateTarget(conn, m, target, action)) === reason) {
			const text = reason === 'targetNotAdmin' ? RESPONSES.targetNotAdmin : RESPONSES[reason];
			return m.reply(text.replace('{num}', target.split('@')[0]));
		}
	}

	const [result] = await applyParticipantChange(conn, m.chat, target, action);
	const num = target.split('@')[0];
	if (result?.status && result.status !== '200') {
		return m.reply(`${RESPONSES.actionFailed.replace('{status}', result.status)} (@${num})`);
	}
	const done = { remove: RESPONSES.kickDone, promote: RESPONSES.promoteDone, demote: RESPONSES.demoteDone }[action];
	await m.reply(`${done.replace('{num}', `@${num}`)} @${num}`);
}

const participantPlugin = (commands, action, description, usageArg) => ({
	commands,
	category: 'group',
	description,
	usage: usageArg,

	async run({ m, conn, args }) {
		await runParticipantCommand({ m, conn, args }, action, usageArg.replace('{prefix}', m.prefix));
	},
});

export const kick = participantPlugin(['kick', 'remove'], 'remove', 'Remove a member from the group (mention, reply, or number).', '{prefix}kick @user');
export const promote = participantPlugin(['promote', 'addadmin'], 'promote', 'Promote a member to admin (mention, reply, or number).', '{prefix}promote @user');
export const demote = participantPlugin(['demote', 'deladmin'], 'demote', 'Demote a group admin (mention, reply, or number).', '{prefix}demote @user');

export default [kick, promote, demote];
