import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	const { session } = await parent();
	const user = session?.user;

	// Require authenticated user
	if (!user) {
		throw redirect(303, '/');
	}

	return {};
};
