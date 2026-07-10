import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { ensureAdmin } from '$lib/server/auth';
import { getDatabase } from '$lib/db/database';

const PAGE_SIZE = 50;

export const load: PageServerLoad = async ({ locals, cookies, url }) => {
	const ok = await ensureAdmin({ locals, cookies });
	if (!ok) {
		throw redirect(303, '/');
	}

	const db = getDatabase();

	const pageParam = parseInt(url.searchParams.get('page') || '1', 10);
	const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;
	const q = (url.searchParams.get('q') || '').trim();
	const eventType = (url.searchParams.get('event') || '').trim();

	const where: string[] = [];
	const params: unknown[] = [];
	if (eventType) {
		where.push('event_type = ?');
		params.push(eventType);
	}
	if (q) {
		where.push('(actor LIKE ? OR target_id LIKE ? OR target_type LIKE ? OR details LIKE ?)');
		const like = `%${q}%`;
		params.push(like, like, like, like);
	}
	const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

	const total = (
		db.prepare(`SELECT COUNT(*) as c FROM logs ${whereSql}`).get(...params) as { c: number }
	).c;

	const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
	const safePage = Math.min(page, pageCount);
	const offset = (safePage - 1) * PAGE_SIZE;

	const logs = db
		.prepare(`SELECT * FROM logs ${whereSql} ORDER BY timestamp DESC, id DESC LIMIT ? OFFSET ?`)
		.all(...params, PAGE_SIZE, offset);

	const eventTypes = (
		db
			.prepare('SELECT DISTINCT event_type FROM logs WHERE event_type IS NOT NULL ORDER BY event_type')
			.all() as { event_type: string }[]
	).map((r) => r.event_type);

	return {
		logs,
		total,
		page: safePage,
		pageSize: PAGE_SIZE,
		pageCount,
		eventTypes,
		filters: { q, eventType }
	};
};
