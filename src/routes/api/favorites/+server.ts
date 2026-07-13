import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { getDatabase } from '$lib/db/database';
import { requireScope } from '$lib/server/permissions';

import { createLogger } from '$lib/server/logger';

const log = createLogger('favorites');
/**
 * GET /api/favorites
 * Gets all favorites of the logged-in user
 */
export const GET: RequestHandler = async (event) => {
	const user = await requireScope(event, 'read');

	try {
		const db = getDatabase();
		const userId = user.user?.id_user;
		if (!userId) {
			return json({ error: 'User context required (session only)' }, { status: 401 });
		}

		const favorites = db
			.prepare('SELECT asset_id FROM user_favorites WHERE user_id = ?')
			.all(userId) as { asset_id: string }[];

		return json({ favorites: favorites.map((f) => f.asset_id) });
	} catch (e: unknown) {
		log.error('Error fetching favorites:', e);
		return json({ error: 'Database error' }, { status: 500 });
	}
};

/**
 * POST /api/favorites
 * Ajoute un asset aux favoris
 * Body: { assetId: string }
 */
export const POST: RequestHandler = async (event) => {
	const user = await requireScope(event, 'write');

	try {
		const body = (await event.request.json()) as { assetId?: string };
		const { assetId } = body;

		if (!assetId) {
			return json({ error: 'assetId is required' }, { status: 400 });
		}

		const userId = user.user?.id_user;
		if (!userId) {
			return json({ error: 'User context required (session only)' }, { status: 401 });
		}

		const db = getDatabase();
		db
			.prepare('INSERT OR IGNORE INTO user_favorites (user_id, asset_id) VALUES (?, ?)')
			.run(userId, assetId);

		return json({ success: true, isFavorite: true });
	} catch (e: unknown) {
		log.error('Error adding favorite:', e);
		return json({ error: 'Database error' }, { status: 500 });
	}
};

/**
 * DELETE /api/favorites
 * Removes an asset from favorites
 * Body: { assetId: string }
 */
export const DELETE: RequestHandler = async (event) => {
	const user = await requireScope(event, 'write');

	try {
		const body = (await event.request.json()) as { assetId?: string };
		const { assetId } = body;

		if (!assetId) {
			return json({ error: 'assetId is required' }, { status: 400 });
		}

		const userId = user.user?.id_user;
		if (!userId) {
			return json({ error: 'User context required (session only)' }, { status: 401 });
		}

		const db = getDatabase();
		db.prepare('DELETE FROM user_favorites WHERE user_id = ? AND asset_id = ?').run(userId, assetId);

		return json({ success: true, isFavorite: false });
	} catch (e: unknown) {
		log.error('Error removing favorite:', e);
		return json({ error: 'Database error' }, { status: 500 });
	}
};
