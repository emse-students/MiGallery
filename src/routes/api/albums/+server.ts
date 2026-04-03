import { json, error as svelteError } from '@sveltejs/kit';
import type { ImmichAlbum, AlbumRow } from '$lib/types/api';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { getDatabase } from '$lib/db/database';
import { logEvent } from '$lib/server/logs';
import { requireScope } from '$lib/server/permissions';
import { ensureError } from '$lib/ts-utils';

const IMMICH_BASE_URL = env.IMMICH_BASE_URL;
const IMMICH_API_KEY = env.IMMICH_API_KEY ?? '';

function normalizePromos(values: unknown[] | undefined): number[] {
	if (!Array.isArray(values)) {
		return [];
	}
	const out = new Set<number>();
	for (const value of values) {
		const n = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
		if (Number.isFinite(n)) {
			out.add(n);
		}
	}
	return [...out].sort((a, b) => a - b);
}

function extractPromoYearsFromLegacyTags(tags: string[]): number[] {
	const out = new Set<number>();
	for (const rawTag of tags) {
		const match = String(rawTag)
			.trim()
			.match(/^promo\s+(\d{4})$/i);
		if (match) {
			out.add(Number.parseInt(match[1], 10));
		}
	}
	return [...out].sort((a, b) => a - b);
}

/**
 * GET /api/albums
 * Récupère la liste des albums de la BDD locale (pas Immich directement)
 * Seuls les albums répertoriés dans MiGallery sont retournés
 */
export const GET: RequestHandler = async (event) => {
	await requireScope(event, 'read');

	try {
		const db = getDatabase();
		const albums = db
			.prepare("SELECT * FROM albums WHERE name != 'PhotoCV' ORDER BY date DESC, name ASC")
			.all() as AlbumRow[];

		const formattedAlbums = albums.map((album) => ({
			id: album.id,
			albumName: album.name,
			description: album.location || '',
			createdAt: album.date || '',
			updatedAt: album.date || '',
			assetCount: 0, // Non disponible depuis la BDD locale
			date: album.date,
			location: album.location,
			visibility: album.visibility,
			visible: album.visible
		}));

		return json(formattedAlbums);
	} catch (err: unknown) {
		const e = ensureError(err);
		console.error('Error in /api/albums GET:', e);
		throw svelteError(500, e.message);
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
 *   formations?: string[],
 *   promos?: number[],
 *   tags?: string[], // legacy support
 *   allowedUsers?: string[]
 * }
 */
export const POST: RequestHandler = async (event) => {
	await requireScope(event, 'write');

	try {
		const body = (await event.request.json()) as {
			albumName?: string;
			date?: string | null;
			location?: string | null;
			visibility?: 'private' | 'authenticated' | 'unlisted';
			visible?: boolean;
			formations?: string[];
			promos?: number[];
			tags?: string[];
			allowedUsers?: string[];
		};
		const {
			albumName,
			date,
			location,
			visibility = 'private',
			visible = true,
			formations = [],
			promos = [],
			tags = [],
			allowedUsers = []
		} = body;

		const normalizedFormations = [
			...new Set(formations.map((f) => String(f).trim()).filter(Boolean))
		];
		const normalizedPromos = normalizePromos([...promos, ...extractPromoYearsFromLegacyTags(tags)]);

		if (!albumName || typeof albumName !== 'string') {
			throw svelteError(400, 'albumName is required');
		}

		if (!IMMICH_BASE_URL) {
			throw svelteError(500, 'IMMICH_BASE_URL not configured');
		}

		const immichRes = await event.fetch(`${IMMICH_BASE_URL}/api/albums`, {
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

		try {
			const db = getDatabase();
			const stmt = db.prepare(
				'INSERT OR IGNORE INTO albums (id, name, date, location, visibility, visible) VALUES (?, ?, ?, ?, ?, ?)'
			);
			stmt.run(albumId, albumName.trim(), date || null, location || null, visibility, visible ? 1 : 0);

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

			if (normalizedFormations.length > 0) {
				const formationStmt = db.prepare(
					'INSERT OR IGNORE INTO album_formation_permissions (album_id, formation) VALUES (?, ?)'
				);
				for (const formation of normalizedFormations) {
					formationStmt.run(albumId, formation);
				}
			}

			if (normalizedPromos.length > 0) {
				const promoStmt = db.prepare(
					'INSERT OR IGNORE INTO album_promo_permissions (album_id, promo_year) VALUES (?, ?)'
				);
				for (const promo of normalizedPromos) {
					promoStmt.run(albumId, promo);
				}
			}

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
		}

		try {
			await logEvent(event, 'create', 'album', albumId, { name: albumName, visibility });
		} catch (logErr) {
			console.warn('logEvent failed (albums POST):', logErr);
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
