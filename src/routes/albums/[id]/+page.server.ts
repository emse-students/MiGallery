import type { PageServerLoad } from './$types';
import { getDatabase } from '$lib/db/database';
import { checkAlbumAccess } from '$lib/albums';
import type { User, Album } from '$lib/types/api';
import { redirect } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ params, parent }) => {
	const paramId = params.id;
	if (!paramId) {
		throw redirect(303, '/');
	}

	const db = getDatabase();

	let albumRow = db.prepare('SELECT * FROM albums WHERE id = ? LIMIT 1').get(paramId) as
		| Album
		| undefined;
	if (!albumRow) {
		const num = Number(paramId);
		if (!isNaN(num)) {
			albumRow = db.prepare('SELECT * FROM albums WHERE id = ? LIMIT 1').get(num) as Album | undefined;
		}
	}

	if (!albumRow) {
		throw redirect(303, '/albums');
	}

	const album: Album = {
		id: String(albumRow.id),
		name: albumRow.name,
		date: albumRow.date,
		location: albumRow.location,
		visibility: albumRow.visibility
	};

	if ((album.visibility || '').toLowerCase() === 'unlisted') {
		return { album };
	}

	const { session } = await parent();
	const user = session?.user as User | undefined;

	if (!user) {
		throw redirect(303, '/');
	}

	const allowed = checkAlbumAccess(user, { ...album, visibility: album.visibility || 'private' });
	if (!allowed) {
		throw redirect(303, '/');
	}

	return { album };
};
