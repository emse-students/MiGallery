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
 * Met à jour un album
 * 
 * Body: { albumName?: string, description?: string }
 */
export const PATCH: RequestHandler = async ({ params, request, fetch }) => {
	try {
		const { id } = params;
		const body = await request.json();
		
	if (!IMMICH_BASE_URL) throw error(500, 'IMMICH_BASE_URL not configured');
	const res = await fetch(`${IMMICH_BASE_URL}/api/albums/${id}`, {
			method: 'PATCH',
			headers: {
				'x-api-key': IMMICH_API_KEY,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(body)
		});

		if (!res.ok) {
			const errorText = await res.text();
			throw error(res.status, `Failed to update album: ${errorText}`);
		}

		const album = await res.json();
		return json(album);
	} catch (err) {
		console.error(`Error in /api/albums/${params.id} PATCH:`, err);
		if (err && typeof err === 'object' && 'status' in err) {
			throw err;
		}
		throw error(500, err instanceof Error ? err.message : 'Internal server error');
	}
};
