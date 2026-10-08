import { GROUP_STATS_TTL_MS } from './ttl.js';
import { db } from '#storage/store.js';

/**
 * Daily per-user group message aggregates. Written on every incoming group
 * message with a single atomic upsert; rows expire via the 30-day TTL window
 * applied at query time and by pruneOlderThan() on write.
 */
const upsert = db.query(`
	INSERT INTO group_message_stats (chat_id, date, user_id, total, text, image, video, audio, sticker, document, other, created_at)
	VALUES ($chatId, $date, $userId, 1, $text, $image, $video, $audio, $sticker, $document, $other, $now)
	ON CONFLICT(chat_id, date, user_id) DO UPDATE SET
		total = total + 1,
		text = text + excluded.text,
		image = image + excluded.image,
		video = video + excluded.video,
		audio = audio + excluded.audio,
		sticker = sticker + excluded.sticker,
		document = document + excluded.document,
		other = other + excluded.other
`);

const classify = (m) => {
	const t = m.type;
	if (t === 'conversation' || t === 'extendedTextMessage') return { text: 1 };
	if (t === 'imageMessage') return { image: 1 };
	if (t === 'videoMessage') return { video: 1 };
	if (t === 'audioMessage') return { audio: 1 };
	if (t === 'stickerMessage') return { sticker: 1 };
	if (t === 'documentMessage' || t === 'documentWithCaptionMessage') return { document: 1 };
	if (t === 'locationMessage' || t === 'liveLocationMessage' || t === 'contactMessage' || t === 'contactsArrayMessage' || t === 'pollCreationMessage') return { other: 1 };
	return { other: 1 };
};

export function record(m) {
	if (!m?.isGroup || !m.sender) return;
	const today = new Date().toISOString().slice(0, 10);
	const c = classify(m);
	upsert.run({
		$chatId: m.chat,
		$date: today,
		$userId: m.sender,
		$now: Date.now(),
		$text: c.text ?? 0,
		$image: c.image ?? 0,
		$video: c.video ?? 0,
		$audio: c.audio ?? 0,
		$sticker: c.sticker ?? 0,
		$document: c.document ?? 0,
		$other: c.other ?? 0,
	});
}

const dayStart = (d) => {
	const dt = new Date(d);
	dt.setHours(0, 0, 0, 0);
	return dt;
};

// Local calendar date (write-side record() and query-side getStats() must use
// the same timezone basis; toISOString() shifts the boundary at UTC+8).
const dateStr = (dt) => {
	const y = dt.getFullYear();
	const m = String(dt.getMonth() + 1).padStart(2, '0');
	const d = String(dt.getDate()).padStart(2, '0');
	return `${y}-${m}-${d}`;
};

/** Aggregate stats for one chat over the given range ('today'|'week'|'month'). */
export function getStats(chatId, range = 'week') {
	const now = new Date();
	let since = dayStart(now);
	if (range === 'today') {
		// keep since
	} else if (range === 'month') {
		since.setDate(since.getDate() - 29);
	} else {
		since.setDate(since.getDate() - 6);
	}

	const rows = db
		.query(
			`SELECT user_id AS userId, SUM(total) AS total, SUM(text) AS text, SUM(image) AS image,
					SUM(video) AS video, SUM(audio) AS audio, SUM(sticker) AS sticker,
					SUM(document) AS document, SUM(other) AS other
			 FROM group_message_stats
			 WHERE chat_id = ? AND date >= ? AND date <= ?
			 GROUP BY user_id
			 ORDER BY SUM(total) DESC`,
		)
		.all(chatId, dateStr(since), dateStr(dayStart(now)));

	return {
		range,
		since: dateStr(since),
		rows,
		members: rows.length,
		messages: rows.reduce((a, r) => a + (r.total ?? 0), 0),
		totals: rows.reduce(
			(acc, r) => ({
				text: acc.text + (r.text ?? 0),
				image: acc.image + (r.image ?? 0),
				video: acc.video + (r.video ?? 0),
				audio: acc.audio + (r.audio ?? 0),
				sticker: acc.sticker + (r.sticker ?? 0),
				document: acc.document + (r.document ?? 0),
				other: acc.other + (r.other ?? 0),
			}),
			{ text: 0, image: 0, video: 0, audio: 0, sticker: 0, document: 0, other: 0 },
		),
	};
}

/** TTL cleanup: anything older than the 30-day window is dropped on write. */
export function prune() {
	const cutoff = new Date();
	cutoff.setDate(cutoff.getDate() - Math.ceil(GROUP_STATS_TTL_MS / 86_400_000));
	db.query('DELETE FROM group_message_stats WHERE date < ?').run(dateStr(cutoff));
}
