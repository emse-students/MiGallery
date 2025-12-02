import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { getDatabase } from '$lib/db/database';
import { getCurrentUser } from '$lib/server/auth';

/**
 * GET /api/favorites
 * Récupère tous les favoris de l'utilisateur connecté
 */
export const GET: RequestHandler = async (event) => {
	const user = await getCurrentUser({ locals: event.locals, cookies: event.cookies });
	if (!user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	try {
		const db = getDatabase();
		const favorites = db
			.prepare('SELECT asset_id FROM user_favorites WHERE user_id = ?')
			.all(user.id_user) as { asset_id: string }[];

		return json({ favorites: favorites.map((f) => f.asset_id) });
	} catch (e: unknown) {
		console.error('Error fetching favorites:', e);
		return json({ error: 'Database error' }, { status: 500 });
	}
};

/**
 * POST /api/favorites
 * Ajoute un asset aux favoris
 * Body: { assetId: string }
 */
export const POST: RequestHandler = async (event) => {
	const user = await getCurrentUser({ locals: event.locals, cookies: event.cookies });
	if (!user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	try {
		const body = (await event.request.json()) as { assetId?: string };
		const { assetId } = body;

		if (!assetId) {
			return json({ error: 'assetId is required' }, { status: 400 });
		}

		const db = getDatabase();
		db
			.prepare('INSERT OR IGNORE INTO user_favorites (user_id, asset_id) VALUES (?, ?)')
			.run(user.id_user, assetId);

		return json({ success: true, isFavorite: true });
	} catch (e: unknown) {
		console.error('Error adding favorite:', e);
		return json({ error: 'Database error' }, { status: 500 });
	}
};

/**
 * DELETE /api/favorites
 * Retire un asset des favoris
 * Body: { assetId: string }
 */
export const DELETE: RequestHandler = async (event) => {
	const user = await getCurrentUser({ locals: event.locals, cookies: event.cookies });
	if (!user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	try {
		const body = (await event.request.json()) as { assetId?: string };
		const { assetId } = body;

		if (!assetId) {
			return json({ error: 'assetId is required' }, { status: 400 });
		}

		const db = getDatabase();
		db
			.prepare('DELETE FROM user_favorites WHERE user_id = ? AND asset_id = ?')
			.run(user.id_user, assetId);

		return json({ success: true, isFavorite: false });
	} catch (e: unknown) {
		console.error('Error removing favorite:', e);
		return json({ error: 'Database error' }, { status: 500 });
	}
};
