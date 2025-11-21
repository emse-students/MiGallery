import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { ensureAdmin } from '$lib/server/auth';
import API_ENDPOINTS from '$lib/admin/endpoints';

export const load: PageServerLoad = async ({ locals, cookies }) => {
	const ok = await ensureAdmin({ locals, cookies });
	if (!ok) {
		throw redirect(303, '/');
	}

	// Static API reference similar to Immich endpoints listing. Keep concise and example-driven.

	const endpoints = API_ENDPOINTS;

	return { endpoints };
};
