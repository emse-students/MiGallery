import { json } from '@sveltejs/kit';
import type { UserRow } from '$lib/types/api';
import type { RequestHandler } from './$types';
import { getDatabase } from '$lib/db/database';
import { requireScope } from '$lib/server/permissions';

export const GET: RequestHandler = async (event) => {
	// list users - admin only
	await requireScope(event, 'admin');

	const db = getDatabase();
	// Exclure uniquement l'admin système (les.roots@etu.emse.fr)
	// Afficher tous les autres utilisateurs, même ceux sans promo_year (nouveaux utilisateurs)
	const rows = db
		.prepare(
			'SELECT id_user, email, prenom, nom, id_photos, role, promo_year FROM users WHERE email != ? ORDER BY promo_year DESC, nom, prenom'
		)
		.all('les.roots@etu.emse.fr') as UserRow[];
	return json({ success: true, users: rows });
};

export const POST: RequestHandler = async (event) => {
	// create user - admin only
	await requireScope(event, 'admin');

	try {
		const body = (await event.request.json()) as {
			id_user?: string;
			email?: string;
			prenom?: string;
			nom?: string;
			role?: string;
			promo_year?: number | null;
			id_photos?: string | null;
		};
		const { id_user, email, prenom, nom, role = 'user', promo_year = null, id_photos = null } = body;
		if (!id_user || !email) {
			return json({ error: 'id_user and email required' }, { status: 400 });
		}

		// Validation email simple
		if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
			return json({ error: 'Invalid email format' }, { status: 400 });
		}

		// Validation role
		if (!['user', 'admin', 'mitviste'].includes(role)) {
			return json({ error: 'Invalid role' }, { status: 400 });
		}

		const db = getDatabase();
		const insert = db.prepare(
			'INSERT INTO users (id_user, email, prenom, nom, role, promo_year, id_photos, first_login) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
		);
		const info = insert.run(
			id_user,
			email,
			prenom || '',
			nom || '',
			role,
			promo_year,
			id_photos,
			id_photos ? 0 : 1
		);
		const created = db
			.prepare(
				'SELECT id_user, email, prenom, nom, id_photos, role, promo_year FROM users WHERE id_user = ?'
			)
			.get(id_user) as UserRow | undefined;
		return json({ success: true, created, changes: info.changes });
	} catch (e) {
		const err = e as Error;
		console.error('POST /api/users error', err);
		if (
			err.message.includes('UNIQUE constraint failed') ||
			err.message.includes('SQLITE_CONSTRAINT_UNIQUE')
		) {
			return json({ success: false, error: 'User already exists' }, { status: 409 });
		}
		return json({ success: false, error: err.message }, { status: 500 });
	}
};
