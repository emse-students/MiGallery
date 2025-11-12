import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	const { session } = await parent();
	const user = session?.user as any;

	// Require authenticated user with id_photos
	if (!user || !user.id_photos) {
		throw redirect(303, '/');
	}

	return {};
};
