import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	const { session } = await parent();
	const user = session?.user;

	if (!user || !user.id_photos) {
		throw redirect(303, '/');
	}

	return {};
};
