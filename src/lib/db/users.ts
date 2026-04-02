import { getDatabase } from '$lib/db/database';

export interface DBUser {
	id_user: string;
	nom: string;
	id_photos?: string | null;
	role: 'admin' | 'mitviste' | 'user';
	promo_year?: number | null;
}

const db = getDatabase();

export function getUserByCasId(casId: string): DBUser | undefined {
	const stmt = db.prepare('SELECT * FROM users WHERE id_user = ?');
	return stmt.get(casId) as DBUser | undefined;
}

export function createUser(user: DBUser) {
	const stmt = db.prepare(`
		INSERT INTO users (id_user, nom, id_photos, role, promo_year)
		VALUES (?, ?, ?, ?, ?)
	`);

	return stmt.run(
		user.id_user,
		user.nom,
		user.id_photos || null,
		user.role,
		user.promo_year || null
	);
}

export function updateUser(user: Partial<DBUser> & { id_user: string }) {
	// Helper simple pour mettre à jour des champs
	const keys = Object.keys(user).filter((k) => k !== 'id_user');
	const sets = keys.map((k) => `${k} = @${k}`).join(', ');
	const stmt = db.prepare(`UPDATE users SET ${sets} WHERE id_user = @id_user`);
	return stmt.run(user);
}
