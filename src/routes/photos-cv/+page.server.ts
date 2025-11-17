import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	const { session } = await parent();
	const user = session?.user as any;

	// Require authenticated user
	if (!user) {
		throw redirect(303, '/');
	}

	// Admin et mitviste peuvent accéder même sans id_photos (pour gérer les imports)
	// Les autres utilisateurs doivent avoir un id_photos
	const canManagePhotos = user.role === 'admin' || user.role === 'mitviste';
	if (!user.id_photos && !canManagePhotos) {
		throw redirect(303, '/');
	}

	return {};
};
