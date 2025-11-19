import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { getDatabase } from '$lib/db/database';

const IMMICH_BASE_URL = env.IMMICH_BASE_URL;
const IMMICH_API_KEY = env.IMMICH_API_KEY;

/**
 * GET /api/albums/[id]
 * Récupère les détails d'un album avec ses assets
 * 
 * Cache: Les albums sont cachés via le proxy /api/immich
 */
export const GET: RequestHandler = async ({ params, fetch }) => {
	try {
		const { id } = params;
		
	if (!IMMICH_BASE_URL) throw error(500, 'IMMICH_BASE_URL not configured');
	const res = await fetch(`${IMMICH_BASE_URL}/api/albums/${id}`, {
			headers: {
				'x-api-key': IMMICH_API_KEY,
				'Accept': 'application/json'
			}
		});

		if (!res.ok) {
			const errorText = await res.text();
			throw error(res.status, `Failed to fetch album: ${errorText}`);
		}

		const album = await res.json();
		return json(album);
	} catch (err) {
		console.error(`Error in /api/albums/${params.id} GET:`, err);
		if (err && typeof err === 'object' && 'status' in err) {
			throw err;
		}
		throw error(500, err instanceof Error ? err.message : 'Internal server error');
	}
};

/**
 * DELETE /api/albums/[id]
 * Supprime un album de manière robuste:
 * 1. Supprime TOUJOURS de la BDD locale (source de vérité pour nous)
 * 2. Essaie de supprimer d'Immich (non-critique)
 */
export const DELETE: RequestHandler = async ({ params, fetch }) => {
	try {
		const { id } = params;
		let immichDeleteSuccess = true;
		let immichDeleteError: string | null = null;

		// ÉTAPE 1: Supprimer de la BDD locale EN PREMIER
		// C'est notre source de vérité, on DOIT la nettoyer
		try {
			const db = getDatabase();
			db.prepare('DELETE FROM albums WHERE id = ?').run(id);
			db.prepare('DELETE FROM album_tag_permissions WHERE album_id = ?').run(id);
			db.prepare('DELETE FROM album_user_permissions WHERE album_id = ?').run(id);
			console.log(`Album ${id} supprimé de la BDD locale`);
		} catch (dbErr) {
			console.error('Error deleting album from local DB:', dbErr);
			throw error(500, `Failed to delete album from database: ${dbErr}`);
		}

		// ÉTAPE 2: Essayer de supprimer d'Immich (non-critique)
		// Si ça échoue, on a au moins nettoyé notre BD
		if (!IMMICH_BASE_URL) {
			console.warn('IMMICH_BASE_URL not configured, skipping Immich deletion');
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
					console.warn(`Immich deletion failed for album ${id}: ${errorText}`);
					// Ne pas throw ici - on a quand même supprimé de la BD locale
				} else {
					console.log(`Album ${id} supprimé d'Immich`);
				}
			} catch (immichErr) {
				immichDeleteSuccess = false;
				immichDeleteError = immichErr instanceof Error ? immichErr.message : String(immichErr);
				console.warn(`Error deleting album from Immich:`, immichErr);
				// Ne pas throw ici - on a quand même supprimé de la BD locale
			}
		}

		return json({
			success: true,
			localDbDeleted: true,
			immichDeleted: immichDeleteSuccess,
			immichError: immichDeleteError
		});
	} catch (err) {
		console.error(`Error in /api/albums/${params.id} DELETE:`, err);
		if (err && typeof err === 'object' && 'status' in err) {
			throw err;
		}
		throw error(500, err instanceof Error ? err.message : 'Internal server error');
	}
};

/**
 * PATCH /api/albums/[id]
 * Met à jour les métadonnées locales d'un album dans la BDD
 * (date, location, visibility, visible, tags, users autorisés)
 * 
 * Les albums Immich et notre BDD sont indépendants (liés uniquement par ID)
 * 
 * Body: {
 *   name?: string,
 *   date?: string | null,
 *   location?: string | null,
 *   visibility?: 'private' | 'authenticated' | 'unlisted',
 *   visible?: boolean,
 *   tags?: string[],
 *   allowedUsers?: string[]
 * }
 */
export const PATCH: RequestHandler = async ({ params, request }) => {
	try {
		const { id } = params;
		const body = await request.json();
		const { name, date, location, visibility, visible, tags, allowedUsers } = body;
		
		const db = getDatabase();
		
		// Vérifier que l'album existe dans la BDD locale
		const existing = db.prepare('SELECT id FROM albums WHERE id = ?').get(id) as any;
		if (!existing) {
			throw error(404, 'Album non trouvé dans la base locale');
		}

		// Mettre à jour les métadonnées locales
		if (name !== undefined || date !== undefined || location !== undefined || visibility !== undefined || visible !== undefined) {
			// Construire dynamiquement la query pour ne mettre à jour que les champs fournis
			const updates: string[] = [];
			const values: any[] = [];

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
				values.push(id); // Pour la clause WHERE
				const stmt = db.prepare(`UPDATE albums SET ${updates.join(', ')} WHERE id = ?`);
				stmt.run(...values);
			}
		}

		// Gérer les tags
		if (tags && Array.isArray(tags)) {
			// Récupérer les tags existants
			const existingTags = db.prepare(
				'SELECT tag FROM album_tag_permissions WHERE album_id = ?'
			).all(id) as any[];
			const existingTagNames = existingTags.map((t: any) => t.tag);

			// Tags à ajouter
			const tagsToAdd = tags.filter(t => !existingTagNames.includes(t));
			for (const tag of tagsToAdd) {
				db.prepare('INSERT INTO album_tag_permissions (album_id, tag) VALUES (?, ?)')
					.run(id, tag);
			}

			// Tags à supprimer
			const tagsToRemove = existingTagNames.filter(t => !tags.includes(t));
			for (const tag of tagsToRemove) {
				db.prepare('DELETE FROM album_tag_permissions WHERE album_id = ? AND tag = ?')
					.run(id, tag);
			}
		}

		// Gérer les utilisateurs autorisés
		if (allowedUsers && Array.isArray(allowedUsers)) {
			// Récupérer les utilisateurs existants
			const existingUsers = db.prepare(
				'SELECT id_user FROM album_user_permissions WHERE album_id = ?'
			).all(id) as any[];
			const existingUserIds = existingUsers.map((u: any) => u.id_user);

			// Utilisateurs à ajouter
			const usersToAdd = allowedUsers.filter(u => !existingUserIds.includes(u));
			for (const userId of usersToAdd) {
				db.prepare('INSERT INTO album_user_permissions (album_id, id_user) VALUES (?, ?)')
					.run(id, userId);
			}

			// Utilisateurs à supprimer
			const usersToRemove = existingUserIds.filter(u => !allowedUsers.includes(u));
			for (const userId of usersToRemove) {
				db.prepare('DELETE FROM album_user_permissions WHERE album_id = ? AND id_user = ?')
					.run(id, userId);
			}
		}

		// Retourner les données mises à jour
		const updated = db.prepare(
			'SELECT id, name, date, location, visibility, visible FROM albums WHERE id = ?'
		).get(id);

		return json({
			success: true,
			album: updated
		});
	} catch (err) {
		console.error(`Error in /api/albums/${params.id} PATCH:`, err);
		if (err && typeof err === 'object' && 'status' in err) {
			throw err;
		}
		throw error(500, err instanceof Error ? err.message : 'Internal server error');
	}
};
