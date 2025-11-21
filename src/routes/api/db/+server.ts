import { json, error } from '@sveltejs/kit';

import { ensureError } from '$lib/ts-utils';
import { getDatabase } from '$lib/db/database';
import type { RequestHandler } from '@sveltejs/kit';

export const POST: RequestHandler = async ({ request, locals }) => {
	try {
		const { sql, params } = (await request.json()) as {
			sql?: string;
			params?: unknown[];
		};

		if (!sql) {
			return json({ error: 'Requête SQL manquante' }, { status: 400 });
		}

		// Vérifier la session fournie par le provider d'auth
		if (!locals.auth) {
			throw error(401, 'Unauthorized');
		}
		const session = await locals.auth();
		const user = session?.user as { role?: string } | undefined;
		if (!user) {
			return json({ error: 'Unauthorized' }, { status: 401 });
		}

		const role = user.role || 'user';

		// Restreindre les requêtes touchant la table users aux admins uniquement
		const touchesUsersTable =
			/\bFROM\s+users\b|\bINTO\s+users\b|\bUPDATE\s+users\b|\bDELETE\s+FROM\s+users\b|\bJOIN\s+users\b/i.test(
				sql
			);
		if (touchesUsersTable && role !== 'admin') {
			return json({ error: 'Forbidden' }, { status: 403 });
		}

		const db = getDatabase();

		const stmt = db.prepare(sql);
		// Déterminer si c'est une requête de lecture ou d'écriture
		const isWriteQuery = /^\s*(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)/i.test(sql);

		if (isWriteQuery) {
			// Pour les requêtes d'écriture, utiliser .run()
			const info = params ? stmt.run(...params) : stmt.run();
			return json({
				success: true,
				changes: info.changes,
				lastInsertRowid: info.lastInsertRowid
			});
		} else {
			// Pour les requêtes de lecture, utiliser .all()
			const results = params ? stmt.all(...params) : stmt.all();
			return json({ success: true, data: results });
		}
	} catch (e: unknown) {
		const error = ensureError(e);
		console.error('Erreur SQL:', error);
		return json(
			{
				success: false,
				error: error.message
			},
			{ status: 500 }
		);
	}
};
