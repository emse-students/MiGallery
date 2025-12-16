import { error } from '@sveltejs/kit';

import { ensureError } from '$lib/ts-utils';
import type { RequestHandler } from './$types';
import { requireScope } from '$lib/server/permissions';
import { getDatabase } from '$lib/db/database';
import fs from 'fs';
import path from 'path';

export const GET: RequestHandler = async (event) => {
	await requireScope(event, 'admin');

	const DB_PATH = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'migallery.db');

	if (!fs.existsSync(DB_PATH)) {
		throw error(404, 'Base de données non trouvée');
	}

	try {
		// Force WAL checkpoint to ensure all data is in the main file
		const db = getDatabase();
		if (db.exec) {
			db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
		}

		const dbBuffer = fs.readFileSync(DB_PATH);
		const filename = `migallery_export_${new Date().toISOString().split('T')[0]}.db`;

		return new Response(dbBuffer, {
			headers: {
				'Content-Type': 'application/x-sqlite3',
				'Content-Disposition': `attachment; filename="${filename}"`,
				'Content-Length': dbBuffer.length.toString()
			}
		});
	} catch (err: unknown) {
		const _err = ensureError(err);
		console.error('Error exporting database:', err);
		throw error(500, "Erreur lors de l'export de la base de données");
	}
};
