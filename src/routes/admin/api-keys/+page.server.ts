import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { ensureAdmin } from '$lib/server/auth';

export const load: PageServerLoad = async ({ locals, cookies }) => {
	const isAdmin = await ensureAdmin({ locals, cookies });
	if (!isAdmin) {
		throw redirect(303, '/');
	}
	return {};
};
