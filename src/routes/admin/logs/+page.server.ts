import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { ensureAdmin } from '$lib/server/auth';
import API_ENDPOINTS from '$lib/admin/endpoints';
import { getDatabase } from '$lib/db/database';

export const load: PageServerLoad = async ({ locals, cookies }) => {
	const ok = await ensureAdmin({ locals, cookies });
	if (!ok) {
		throw redirect(303, '/');
	}

	const db = getDatabase();
	const logs = db.prepare('SELECT * FROM logs ORDER BY timestamp DESC LIMIT 200').all();

	const endpoints = API_ENDPOINTS;

	return { endpoints, logs };
};
