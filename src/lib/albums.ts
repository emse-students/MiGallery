import { getDatabase } from '$lib/db/database';
import type { User, AlbumRow } from '$lib/types/api';

/**
 * Check whether a given user can access an album row from our local albums table.
 * Rules (implemented):
 * - not logged-in => no access
 * - role 'mitviste' or 'admin' => full access
 * - explicit user permission in album_user_permissions => access
 * - formation permission matching user formation => access
 * - promo permission matching user's promo => access
 * - legacy tag permission matching user's promo_year (tag = `Promo <year>`) => access
 * - visibility 'authenticated' => any logged-in user has access
 * - visibility 'unlisted' => only users with explicit permission/criteria or mitviste/admin
 * - visibility 'private' => only users with explicit permission/criteria or mitviste/admin
 */
export function checkAlbumAccess(user: User | null | undefined, album: AlbumRow): boolean {
	const vis = (album.visibility || 'authenticated').toLowerCase();
	if (vis === 'unlisted') {
		return true;
	}
	if (!user) {
		return false;
	}
	const role = (user.role || 'user').toLowerCase();
	if (role === 'mitviste' || role === 'admin') {
		return true;
	}

	const db = getDatabase();

	const userPerm = db
		.prepare('SELECT 1 FROM album_user_permissions WHERE album_id = ? AND id_user = ? LIMIT 1')
		.get(album.id, user.id_user) as { 1: number } | undefined;
	if (userPerm) {
		return true;
	}

	const normalizedFormation = (user.formation || '').trim().toLowerCase();
	if (normalizedFormation) {
		const formationPerm = db
			.prepare(
				'SELECT 1 FROM album_formation_permissions WHERE album_id = ? AND lower(formation) = ? LIMIT 1'
			)
			.get(album.id, normalizedFormation) as { 1: number } | undefined;
		if (formationPerm) {
			return true;
		}
	}

	const promoYear = user.promo_year ?? user.promo;
	if (typeof promoYear === 'number') {
		const promoPerm = db
			.prepare('SELECT 1 FROM album_promo_permissions WHERE album_id = ? AND promo_year = ? LIMIT 1')
			.get(album.id, promoYear) as { 1: number } | undefined;
		if (promoPerm) {
			return true;
		}
	}

	if (promoYear) {
		const tag = `Promo ${promoYear}`;
		const tagPerm = db
			.prepare('SELECT 1 FROM album_tag_permissions WHERE album_id = ? AND tag = ? LIMIT 1')
			.get(album.id, tag) as { 1: number } | undefined;
		if (tagPerm) {
			return true;
		}
	} // visibility rules
	if (vis === 'authenticated') {
		return true;
	} // any logged-in user

	return false;
}

export function getAlbumById(id: string): AlbumRow | null {
	const db = getDatabase();
	const row = db.prepare('SELECT * FROM albums WHERE id = ?').get(id) as AlbumRow | undefined;
	if (!row) {
		return null;
	}
	return row;
}

export function listAllAlbums(): AlbumRow[] {
	const db = getDatabase();
	const rows = db
		.prepare('SELECT * FROM albums WHERE visible = 1 ORDER BY date DESC, name ASC')
		.all() as AlbumRow[];
	return rows;
}

export function getAllAlbums(): AlbumRow[] {
	const db = getDatabase();
	const rows = db.prepare('SELECT * FROM albums ORDER BY date DESC, name ASC').all() as AlbumRow[];
	return rows;
}
