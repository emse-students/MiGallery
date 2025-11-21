import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ parent }) => {
	// Use session from parent layout (respects signed cookie)
	const { session } = await parent();
	const user = session?.user;

	if (!user || user.role !== 'admin') {
		throw redirect(303, '/');
	}

	return {};
};
