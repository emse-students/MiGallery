import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ parent }) => {
	const { session } = await parent();
	const user = session?.user;

	if (!user) {
		throw redirect(303, '/');
	}

	// Trash is admin-only: mitviste no longer has access (moved under /admin).
	if (user.role !== 'admin') {
		throw redirect(303, '/');
	}

	return {};
};
