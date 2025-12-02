import { json, error } from '@sveltejs/kit';

import { ensureError } from '$lib/ts-utils';
import { getDatabase } from '$lib/db/database';
import { getCurrentUser } from '$lib/server/auth';
import type { RequestHandler } from '@sveltejs/kit';

export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	try {
		const { sql, params } = (await request.json()) as {
			sql?: string;
			params?: unknown[];
		};

		if (!sql) {
			return json({ error: 'Requête SQL manquante' }, { status: 400 });
		}

		// Resolve session and DB user. We allow the cookie fast-path (dbUser)
		// even when the provider session is not present.
		if (!locals.auth) {
			console.warn('[POST /api/db] no locals.auth available');
			throw error(401, 'Unauthorized');
		}
		const session = await locals.auth();
		const sessionUser = session?.user as { role?: string; id?: string } | undefined;
		// Resolve DB user (tries signed cookie first then provider mapping)
		const dbUser = await getCurrentUser({ locals, cookies });
		// If neither provider session nor cookie-mapped db user is available, deny
		if (!sessionUser && !dbUser) {
			return json({ error: 'Unauthorized' }, { status: 401 });
		}
		const role = dbUser?.role || sessionUser?.role || 'user';

		// Restreindre les requêtes touchant la table users aux admins uniquement
		const touchesUsersTable =
			/\bFROM\s+users\b|\bINTO\s+users\b|\bUPDATE\s+users\b|\bDELETE\s+FROM\s+users\b|\bJOIN\s+users\b/i.test(
				sql
			);
		if (touchesUsersTable && role !== 'admin') {
			// Allow non-admins to operate on the users table only for their own user row.
			const userId = dbUser?.id_user;
			if (!userId) {
				console.warn(
					'[POST /api/db] forbidden: non-admin without mapped db user attempted users-table access'
				);
				return json({ error: 'Forbidden' }, { status: 403 });
			}

			// If the query contains a WHERE id_user = ? placeholder, ensure params includes the current user id
			const whereIdPlaceholder = /WHERE\s+id_user\s*=\s*\?/i.test(sql || '');
			const containsLiteralId = new RegExp(
				`\\bWHERE\\s+id_user\\s*=\\s*('|")?${userId.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}('|")?`,
				'i'
			);

			if (whereIdPlaceholder) {
				if (!params || !Array.isArray(params) || !params.includes(userId)) {
					console.warn(
						'[POST /api/db] forbidden: params do not include current user id for users-table write/read'
					);
					return json({ error: 'Forbidden' }, { status: 403 });
				}
			} else if (!containsLiteralId) {
				// No placeholder and no literal id found — deny
				console.warn('[POST /api/db] forbidden: users-table query does not target current user', {
					sql
				});
				return json({ error: 'Forbidden' }, { status: 403 });
			}
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
