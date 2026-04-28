import { getDatabase } from '$lib/db/database';

export interface DBUser {
	id_user: string;
	name: string;
	first_name?: string | null;
	last_name?: string | null;
	photos_id?: string | null;
	role: 'admin' | 'mitviste' | 'user';
	promo?: number | null;
	formation?: string | null;
	first_login?: number | null;
}

export function getUserByCasId(casId: string): DBUser | undefined {
	const db = getDatabase();
	const stmt = db.prepare('SELECT * FROM users WHERE id_user = ?');
	return stmt.get(casId) as DBUser | undefined;
}

export function createUser(user: DBUser) {
	const db = getDatabase();
	const stmt = db.prepare(`
		INSERT INTO users (id_user, name, first_name, last_name, photos_id, role, promo, formation, first_login)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
	`);

	return stmt.run(
		user.id_user,
		user.name,
		user.first_name || null,
		user.last_name || null,
		user.photos_id || null,
		user.role,
		user.promo || null,
		user.formation || null,
		user.first_login ?? 1
	);
}

export function updateUser(user: Partial<DBUser> & { id_user: string }) {
	const db = getDatabase();
	// Helper simple pour mettre à jour des champs
	const keys = Object.keys(user).filter((k) => k !== 'id_user');
	const sets = keys.map((k) => `${k} = @${k}`).join(', ');
	const stmt = db.prepare(`UPDATE users SET ${sets} WHERE id_user = @id_user`);
	return stmt.run(user);
}
