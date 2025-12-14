import type { PageServerLoad } from './$types';
import { ensureAdmin } from '$lib/server/auth';

export const load: PageServerLoad = async ({ locals, cookies }) => {
	// Ensure admin access (throws/redirects if not)
	await ensureAdmin({ locals, cookies });
	return {};
};
