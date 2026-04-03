import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getDatabase } from '$lib/db/database';
import { requireScope } from '$lib/server/permissions';

const DEFAULT_FORMATIONS = ['ICM', 'ISMIN', 'FSSS', 'Master'];

function getCurrentSchoolYear(referenceDate: Date = new Date()): number {
	const year = referenceDate.getFullYear();
	const month = referenceDate.getMonth() + 1;
	return month >= 9 ? year + 1 : year;
}

function getDefaultPromos(referenceDate: Date = new Date()): number[] {
	const currentSchoolYear = getCurrentSchoolYear(referenceDate);
	return [currentSchoolYear - 3, currentSchoolYear - 2, currentSchoolYear - 1, currentSchoolYear];
}

export const GET: RequestHandler = async (event) => {
	await requireScope(event, 'write');

	const db = getDatabase();

	const userRows = db
		.prepare(
			`SELECT id_user, name, first_name, last_name, formation, promo
			 FROM users
			 ORDER BY name ASC, first_name ASC`
		)
		.all() as {
		id_user: string;
		name: string | null;
		first_name: string | null;
		last_name: string | null;
		formation: string | null;
		promo: number | null;
	}[];

	const formationsFromUsers = userRows
		.map((u) => (u.formation || '').trim())
		.filter((f) => f.length > 0);
	const formations = [...new Set([...DEFAULT_FORMATIONS, ...formationsFromUsers])].sort((a, b) =>
		a.localeCompare(b)
	);

	const promosFromUsers = userRows
		.map((u) => u.promo)
		.filter((p): p is number => typeof p === 'number' && Number.isFinite(p));
	const promos = [...new Set([...getDefaultPromos(), ...promosFromUsers])].sort((a, b) => a - b);

	const users = userRows.map((u) => ({
		id_user: u.id_user,
		name: u.name || [u.first_name, u.last_name].filter(Boolean).join(' '),
		first_name: u.first_name,
		last_name: u.last_name,
		formation: u.formation,
		promo: u.promo
	}));

	return json({
		success: true,
		formations,
		promos,
		users
	});
};
