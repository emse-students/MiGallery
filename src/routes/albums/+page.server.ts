import type { PageServerLoad } from './$types';
import { listAllAlbums, getAllAlbums, checkAlbumAccess } from '$lib/albums';
import type { User } from '$lib/types/api';
import { redirect } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ parent }) => {
	const { session } = await parent();
	const user = session?.user as User | undefined;

	if (!user) {
		throw redirect(303, '/');
	}

	const userRole = (user.role || '').toLowerCase();
	const isStaff = userRole === 'admin' || userRole === 'mitviste';
	const albums = isStaff ? getAllAlbums() : listAllAlbums();
	const allowed = albums.filter((a) => checkAlbumAccess(user, a));

	return { albums: allowed };
};
