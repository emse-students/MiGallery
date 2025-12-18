import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	const { session } = await parent();
	const user = session?.user;

	if (!user) {
		throw redirect(303, '/');
	}

	const canManagePhotos = user.role === 'admin' || user.role === 'mitviste';
	if (!user.id_photos && !canManagePhotos) {
		throw redirect(303, '/');
	}

	return {};
};
