import { json, error } from '@sveltejs/kit';
import type { ImmichAlbum } from '$lib/types/api';
import { ensureError } from '$lib/ts-utils';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { getDatabase } from '$lib/db/database';
import { requireScope } from '$lib/server/permissions';
import { logEvent } from '$lib/server/logs';
import { fetchAlbumAssets } from '$lib/immich/album-assets';

import { createLogger } from '$lib/server/logger';

const log = createLogger('albums-id');
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
 * GET /api/albums/[id]
 * Fetches the details of an album with its assets
 *
 * Cache: Albums are cached via the /api/immich proxy
 */
export const GET: RequestHandler = async (event) => {
	const { id } = event.params;
	try {
		await requireScope(event, 'read');
		const { fetch } = event;

		if (!IMMICH_BASE_URL) {
			throw error(500, 'IMMICH_BASE_URL not configured');
		}
		const res = await fetch(`${IMMICH_BASE_URL}/api/albums/${id}`, {
			headers: {
				'x-api-key': IMMICH_API_KEY,
				Accept: 'application/json'
			}
		});

		if (!res.ok) {
			const errorText = await res.text();
			throw error(res.status, `Failed to fetch album: ${errorText}`);
		}

		const album = (await res.json()) as ImmichAlbum;
		const assetList = await fetchAlbumAssets(fetch, IMMICH_BASE_URL, IMMICH_API_KEY, id);
		return json({ ...album, assets: assetList });
	} catch (e: unknown) {
		const err = ensureError(e);
		log.error(`Error in /api/albums/${id} GET:`, err);
		if (e && typeof e === 'object' && 'status' in e) {
			throw e;
		}
		throw error(500, err.message);
	}
};

/**
 * DELETE /api/albums/[id]
 * Deletes an album robustly:
 * 1. ALWAYS deletes from the local database (source of truth for us)
 * 2. Attempts to delete from Immich (non-critical)
 */
export const DELETE: RequestHandler = async (event) => {
	await requireScope(event, 'write');
	try {
		const { id } = event.params;
		const { fetch } = event;
		let immichDeleteSuccess = true;
		let immichDeleteError: string | null = null;

		try {
			const db = getDatabase();
			db.prepare('DELETE FROM albums WHERE id = ?').run(id);
			db.prepare('DELETE FROM album_permissions WHERE album_id = ?').run(id);
		} catch (dbErr: unknown) {
			const err = ensureError(dbErr);
			log.error('Error deleting album from local DB:', err);
			throw error(500, `Failed to delete album from database: ${err.message}`);
		}

		if (!IMMICH_BASE_URL) {
			log.warn('IMMICH_BASE_URL not configured, skipping Immich deletion');
		} else {
			try {
				const res = await fetch(`${IMMICH_BASE_URL}/api/albums/${id}`, {
					method: 'DELETE',
					headers: {
						'x-api-key': IMMICH_API_KEY
					}
				});

				if (!res.ok) {
					const errorText = await res.text();
					immichDeleteSuccess = false;
					immichDeleteError = errorText;
					log.warn(`Immich deletion failed for album ${id}: ${errorText}`);
				}
			} catch (immichErr: unknown) {
				const err = ensureError(immichErr);
				immichDeleteSuccess = false;
				immichDeleteError = err.message;
				log.warn('Error deleting album from Immich:', err);
			}
		}

		try {
			await logEvent(event, 'delete', 'album', event.params.id, {
				immichDeleted: immichDeleteSuccess,
				immichError: immichDeleteError
			});
		} catch (logErr) {
			log.warn('logEvent failed (albums DELETE):', logErr);
		}

		return json({
			success: true,
			localDbDeleted: true,
			immichDeleted: immichDeleteSuccess,
			immichError: immichDeleteError
		});
	} catch (e: unknown) {
		const err = ensureError(e);
		log.error(`Error in /api/albums/${event.params.id} DELETE:`, err);
		if (e && typeof e === 'object' && 'status' in e) {
			throw e;
		}
		throw error(500, err.message);
	}
};

/**
 * PATCH /api/albums/[id]
 * Updates the local metadata of an album in the database
 * (date, location, visibility, visible, tags, authorized users)
 *
 * Immich albums and our database are independent (linked only by ID)
 *
 * Body: {
 *   name?: string,
 *   date?: string | null,
 *   location?: string | null,
 *   visibility?: 'private' | 'authenticated' | 'unlisted',
 *   visible?: boolean,
 *   formations?: string[],
 *   promos?: number[],
 *   tags?: string[], // legacy support
 *   allowedUsers?: string[]
 * }
 */
export const PATCH: RequestHandler = async (event) => {
	await requireScope(event, 'write');
	try {
		const { id } = event.params;
		const body = (await event.request.json()) as {
			name?: string;
			date?: string | null;
			location?: string | null;
			visibility?: 'private' | 'authenticated' | 'unlisted';
			visible?: boolean;
			formations?: string[];
			promos?: number[];
			tags?: string[];
			allowedUsers?: string[];
		};
		const { name, date, location, visibility, visible, formations, promos, tags, allowedUsers } =
			body;

		const db = getDatabase();

		const existing = db.prepare('SELECT id FROM albums WHERE id = ?').get(id);
		if (!existing) {
			throw error(404, 'Album not found in the local database');
		}

		if (
			name !== undefined ||
			date !== undefined ||
			location !== undefined ||
			visibility !== undefined ||
			visible !== undefined
		) {
			const updates: string[] = [];
			const values: unknown[] = [];

			if (name !== undefined) {
				updates.push('name = ?');
				values.push(name);
			}
			if (date !== undefined) {
				updates.push('date = ?');
				values.push(date);
			}
			if (location !== undefined) {
				updates.push('location = ?');
				values.push(location);
			}
			if (visibility !== undefined) {
				updates.push('visibility = ?');
				values.push(visibility);
			}
			if (visible !== undefined) {
				updates.push('visible = ?');
				values.push(visible ? 1 : 0);
			}

			if (updates.length > 0) {
				values.push(id); // For the WHERE clause
				const stmt = db.prepare(`UPDATE albums SET ${updates.join(', ')} WHERE id = ?`);
				stmt.run(...values);
			}
		}

		if (tags && Array.isArray(tags)) {
			const existingTags = db
				.prepare("SELECT value FROM album_permissions WHERE album_id = ? AND kind = 'tag'")
				.all(id) as { value: string }[];
			const existingTagNames = existingTags.map((t) => t.value);

			const tagsToAdd = tags.filter((t) => !existingTagNames.includes(t));
			for (const tag of tagsToAdd) {
				db
					.prepare("INSERT INTO album_permissions (album_id, kind, value) VALUES (?, 'tag', ?)")
					.run(id, tag);
			}

			const tagsToRemove = existingTagNames.filter((t) => !tags.includes(t));
			for (const tag of tagsToRemove) {
				db
					.prepare("DELETE FROM album_permissions WHERE album_id = ? AND kind = 'tag' AND value = ?")
					.run(id, tag);
			}
		}

		if (allowedUsers && Array.isArray(allowedUsers)) {
			const existingUsers = db
				.prepare("SELECT value FROM album_permissions WHERE album_id = ? AND kind = 'user'")
				.all(id) as { value: string }[];
			const existingUserIds = existingUsers.map((u) => u.value);

			const usersToAdd = allowedUsers.filter((u) => !existingUserIds.includes(u));
			for (const userId of usersToAdd) {
				db
					.prepare("INSERT INTO album_permissions (album_id, kind, value) VALUES (?, 'user', ?)")
					.run(id, userId);
			}

			const usersToRemove = existingUserIds.filter((u) => !allowedUsers.includes(u));
			for (const userId of usersToRemove) {
				db
					.prepare("DELETE FROM album_permissions WHERE album_id = ? AND kind = 'user' AND value = ?")
					.run(id, userId);
			}
		}

		if (Array.isArray(formations)) {
			const normalizedFormations = [
				...new Set(formations.map((f) => String(f).trim()).filter(Boolean))
			];
			const existingFormations = db
				.prepare("SELECT value FROM album_permissions WHERE album_id = ? AND kind = 'formation'")
				.all(id) as { value: string }[];
			const existingFormationNames = existingFormations.map((f) => f.value);

			const formationsToAdd = normalizedFormations.filter(
				(formation) => !existingFormationNames.includes(formation)
			);
			for (const formation of formationsToAdd) {
				db
					.prepare("INSERT INTO album_permissions (album_id, kind, value) VALUES (?, 'formation', ?)")
					.run(id, formation);
			}

			const formationsToRemove = existingFormationNames.filter(
				(formation) => !normalizedFormations.includes(formation)
			);
			for (const formation of formationsToRemove) {
				db
					.prepare(
						"DELETE FROM album_permissions WHERE album_id = ? AND kind = 'formation' AND value = ?"
					)
					.run(id, formation);
			}
		}

		if (Array.isArray(promos) || Array.isArray(tags)) {
			const normalizedPromos = normalizePromos([
				...(Array.isArray(promos) ? promos : []),
				...extractPromoYearsFromLegacyTags(Array.isArray(tags) ? tags : [])
			]);
			const existingPromos = db
				.prepare("SELECT value FROM album_permissions WHERE album_id = ? AND kind = 'promo'")
				.all(id) as { value: string }[];
			const existingPromoYears = existingPromos.map((p) => Number(p.value));

			const promosToAdd = normalizedPromos.filter((promo) => !existingPromoYears.includes(promo));
			for (const promo of promosToAdd) {
				db
					.prepare("INSERT INTO album_permissions (album_id, kind, value) VALUES (?, 'promo', ?)")
					.run(id, String(promo));
			}

			const promosToRemove = existingPromoYears.filter((promo) => !normalizedPromos.includes(promo));
			for (const promo of promosToRemove) {
				db
					.prepare("DELETE FROM album_permissions WHERE album_id = ? AND kind = 'promo' AND value = ?")
					.run(id, String(promo));
			}
		}

		const updated = db
			.prepare('SELECT id, name, date, location, visibility, visible FROM albums WHERE id = ?')
			.get(id);

		try {
			await logEvent(event, 'update', 'album', id, { name, date, location, visibility, visible });
		} catch (logErr) {
			log.warn('logEvent failed (albums PATCH):', logErr);
		}

		return json({
			success: true,
			album: updated
		});
	} catch (e: unknown) {
		const err = ensureError(e);
		log.error(`Error in /api/albums/${event.params.id} PATCH:`, err);
		if (e && typeof e === 'object' && 'status' in e) {
			throw e;
		}
		throw error(500, err.message);
	}
};
