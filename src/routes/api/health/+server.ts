import { json } from '@sveltejs/kit';

import { ensureError } from '$lib/ts-utils';
import type { RequestHandler } from './$types';
import { getDatabase } from '$lib/db/database';
import { requireScope } from '$lib/server/permissions';

/**
 * GET /api/health
 * Health check endpoint - vérifie que l'API et la DB sont opérationnelles
 */
export const GET: RequestHandler = async (event) => {
	await requireScope(event, 'public');
	try {
		const db = getDatabase();
		db.prepare('SELECT 1').get();

		return json({
			status: 'ok',
			timestamp: new Date().toISOString(),
			database: 'connected'
		});
	} catch (e: unknown) {
		const err = ensureError(e);
		return json(
			{
				status: 'error',
				timestamp: new Date().toISOString(),
				database: 'disconnected',
				error: err.message
			},
			{ status: 503 }
		);
	}
};
