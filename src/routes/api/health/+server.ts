import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDatabase } from '$lib/db/database';

/**
 * GET /api/health
 * Health check endpoint - vérifie que l'API et la DB sont opérationnelles
 */
export const GET: RequestHandler = async () => {
	try {
		// Vérifier la connexion à la base de données
		const db = getDatabase();
		db.prepare('SELECT 1').get();
		
		return json({
			status: 'ok',
			timestamp: new Date().toISOString(),
			database: 'connected'
		});
	} catch (err) {
		return json({
			status: 'error',
			timestamp: new Date().toISOString(),
			database: 'disconnected',
			error: err instanceof Error ? err.message : 'Unknown error'
		}, { status: 503 });
	}
};
