import type { PageServerLoad } from './$types';
import { listAllAlbums, getAllAlbums, checkAlbumAccess } from '$lib/albums';
import type { Album, User } from '$lib/types/api';
import { redirect } from '@sveltejs/kit';
import { loginBounceTarget } from '$lib/auth-redirect';

export const load: PageServerLoad = async ({ parent, url }) => {
	const { session } = await parent();
	const user = session?.user as User | undefined;

	if (!user) {
		throw redirect(303, loginBounceTarget(url.pathname + url.search));
	}

	const userRole = (user.role || '').toLowerCase();
	const isStaff = userRole === 'admin' || userRole === 'mitviste';
	const albums = isStaff ? getAllAlbums() : listAllAlbums();

	// The cover asset ships with the list: the grid renders every cover on first
	// paint instead of asking the server which asset each cover is.
	const allowed: Album[] = albums
		.filter((a) => checkAlbumAccess(user, a))
		.map((a) => ({
			id: String(a.id),
			name: a.name,
			date: a.date,
			location: a.location,
			visibility: a.visibility,
			visible: a.visible,
			coverAssetId: a.cover_asset_id ?? null,
			coverAssetType: a.cover_asset_type ?? null
		}));

	return { albums: allowed };
};
