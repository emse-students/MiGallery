import type { PageServerLoad } from './$types';
import { getDatabase } from '$lib/db/database';
import { checkAlbumAccess } from '$lib/albums';
import type { User, Album } from '$lib/types/api';
import { redirect } from '@sveltejs/kit';

/** Formate la date et le lieu en description OG lisible (ex. "15 mai 2024 · Paris"). */
function buildOgDescription(date?: string | null, location?: string | null): string {
	const parts: string[] = [];
	if (date) {
		try {
			const d = new Date(`${date}T12:00:00`);
			parts.push(d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }));
		} catch {
			parts.push(date);
		}
	}
	if (location) {
		parts.push(location);
	}
	return parts.join(' · ') || 'Album photo · MiGallery';
}

export const load: PageServerLoad = async ({ params, parent, url }) => {
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

	const ogCoverUrl =
		album.visibility !== 'private' ? `${url.origin}/api/albums/${album.id}/og-cover` : null;
	const ogDescription = buildOgDescription(album.date, album.location);

	if ((album.visibility || '').toLowerCase() === 'unlisted') {
		return { album, ogCoverUrl, ogDescription };
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

	return { album, ogCoverUrl, ogDescription };
};
