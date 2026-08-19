import type { PageServerLoad } from './$types';
import type { SeoMeta } from '$lib/seo';
import { m } from '$lib/paraglide/messages';
import { getDatabase } from '$lib/db/database';
import { checkAlbumAccess } from '$lib/albums';
import type { User, Album } from '$lib/types/api';
import { redirect } from '@sveltejs/kit';
import { loginBounceTarget } from '$lib/auth-redirect';

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
		Album | undefined;
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

	// The link-preview card for this album, rendered by the root layout.
	//
	// A PRIVATE album gets no image: an og:image is fetched by whoever the link reaches, with no
	// session and no permission check, so publishing one would hand out the cover of an album the
	// recipient cannot open. The rest of the card is the album's own name, date and place - which
	// is what a shared link is FOR - and an unlisted album is exactly the case built for sharing.
	const seo: SeoMeta = {
		title: album.name || m.albumd_default_title(),
		description: buildOgDescription(album.date, album.location),
		image: album.visibility !== 'private' ? `${url.origin}/api/albums/${album.id}/og-cover` : null,
		imageAlt: m.albumd_cover_alt(),
		// The og-cover endpoint renders a fixed 1200x630 WebP, so these describe THIS image.
		imageWidth: 1200,
		imageHeight: 630,
		imageType: 'image/webp'
	};

	if ((album.visibility || '').toLowerCase() === 'unlisted') {
		return { album, seo };
	}

	const { session } = await parent();
	const user = session?.user as User | undefined;

	// A shared album link is the whole point of this page: send an anonymous
	// visitor home CARRYING it, so signing in lands them on the album.
	if (!user) {
		throw redirect(303, loginBounceTarget(url.pathname + url.search));
	}

	// Signed in and still refused is a different answer: no destination, or the
	// login would return them here to be refused again.
	const allowed = checkAlbumAccess(user, { ...album, visibility: album.visibility || 'private' });
	if (!allowed) {
		throw redirect(303, '/');
	}

	return { album, seo };
};
