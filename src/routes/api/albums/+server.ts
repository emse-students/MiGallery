import { json, error as svelteError } from '@sveltejs/kit';
import type { ImmichAlbum } from '$lib/types/api';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { getDatabase } from '$lib/db/database';
import { verifyRawKeyWithScope } from '$lib/db/api-keys';
import { getCurrentUser } from '$lib/server/auth';

const IMMICH_BASE_URL = env.IMMICH_BASE_URL;
const IMMICH_API_KEY = env.IMMICH_API_KEY ?? '';

/**
 * GET /api/albums
 * Récupère la liste de tous les albums Immich
 *
 * Cache: Les albums sont cachés via le proxy /api/immich
 */
export const GET: RequestHandler = async ({ fetch, request, locals, cookies }) => {
	try {
		if (!IMMICH_BASE_URL) {
			throw svelteError(500, 'IMMICH_BASE_URL not configured');
		}

		// Autorisation: session utilisateur OU x-api-key avec scope "read"
		try {
			const user = await getCurrentUser({ locals, cookies });
			if (!user) {
				const raw = request.headers.get('x-api-key') || undefined;
				if (!verifyRawKeyWithScope(raw, 'read')) {
					throw svelteError(401, 'Unauthorized');
				}
			}
		} catch {
			throw svelteError(401, 'Unauthorized');
		}
		const res = await fetch(`${IMMICH_BASE_URL}/api/albums`, {
			headers: {
				'x-api-key': IMMICH_API_KEY,
				Accept: 'application/json'
			}
		});

		if (!res.ok) {
			const errorText = await res.text();
			throw svelteError(res.status, `Failed to fetch albums: ${errorText}`);
		}

		const albums = (await res.json()) as ImmichAlbum[];

		// Filtrer l'album PhotoCV (caché)
		const visibleAlbums = albums.filter((a) => a.albumName !== 'PhotoCV');

		return json(visibleAlbums);
	} catch (err: unknown) {
		console.error('Error in /api/albums GET:', err);
		if (err && typeof err === 'object' && 'status' in err) {
			throw err;
		}
		throw svelteError(500, err instanceof Error ? err.message : 'Internal server error');
	}
};

/**
 * POST /api/albums
 * Crée un nouvel album dans Immich et dans la base de données locale
 *
 * Body: {
 *   albumName: string,
 *   date?: string,
 *   location?: string,
 *   visibility?: 'private' | 'authenticated' | 'unlisted',
 *   visible?: boolean,
 *   tags?: string[],
 *   allowedUsers?: string[]
 * }
 */
export const POST: RequestHandler = async ({ request, fetch }) => {
	try {
		const body = (await request.json()) as {
			albumName?: string;
			date?: string | null;
			location?: string | null;
			visibility?: 'private' | 'authenticated' | 'unlisted';
			visible?: boolean;
			tags?: string[];
			allowedUsers?: string[];
		};
		const {
			albumName,
			date,
			location,
			visibility = 'private',
			visible = true,
			tags = [],
			allowedUsers = []
		} = body;

		if (!albumName || typeof albumName !== 'string') {
			throw svelteError(400, 'albumName is required');
		}

		if (!IMMICH_BASE_URL) {
			throw svelteError(500, 'IMMICH_BASE_URL not configured');
		}

		// 1. Créer l'album dans Immich
		const immichRes = await fetch(`${IMMICH_BASE_URL}/api/albums`, {
			method: 'POST',
			headers: {
				'x-api-key': IMMICH_API_KEY,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				albumName: albumName.trim(),
				description: 'Created via MiGallery'
			})
		});

		if (!immichRes.ok) {
			const errorText = await immichRes.text();
			throw svelteError(immichRes.status, `Failed to create album in Immich: ${errorText}`);
		}

		const immichAlbum = (await immichRes.json()) as ImmichAlbum;
		const albumId = immichAlbum.id;

		if (!albumId) {
			throw svelteError(500, 'No album ID returned from Immich');
		}

		// 2. Créer l'album dans la base de données locale
		try {
			const db = getDatabase();
			const stmt = db.prepare(
				'INSERT OR IGNORE INTO albums (id, name, date, location, visibility, visible) VALUES (?, ?, ?, ?, ?, ?)'
			);
			stmt.run(albumId, albumName.trim(), date || null, location || null, visibility, visible ? 1 : 0);

			// 3. Ajouter les tags si fournis
			if (Array.isArray(tags) && tags.length > 0) {
				const tagStmt = db.prepare(
					'INSERT OR IGNORE INTO album_tag_permissions (album_id, tag) VALUES (?, ?)'
				);
				for (const tag of tags) {
					const trimmedTag = String(tag).trim();
					if (trimmedTag) {
						tagStmt.run(albumId, trimmedTag);
					}
				}
			}

			// 4. Ajouter les utilisateurs autorisés si fournis
			if (Array.isArray(allowedUsers) && allowedUsers.length > 0) {
				const userStmt = db.prepare(
					'INSERT OR IGNORE INTO album_user_permissions (album_id, id_user) VALUES (?, ?)'
				);
				for (const userId of allowedUsers) {
					const trimmedUserId = String(userId).trim();
					if (trimmedUserId) {
						userStmt.run(albumId, trimmedUserId);
					}
				}
			}
		} catch (dbErr) {
			console.error('Error saving album to local DB:', dbErr);
			// Continue anyway - the album exists in Immich
		}

		return json({ ...immichAlbum, id: albumId });
	} catch (err) {
		const e = err as Error;
		console.error('Error in POST /api/albums:', e);
		if (e && typeof e === 'object' && 'status' in e) {
			throw e;
		}
		throw svelteError(500, e instanceof Error ? e.message : 'Internal server error');
	}
};
