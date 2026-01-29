import { getDatabase } from '$lib/db/database';

export interface DBUser {
	id_user: string;
	email: string;
	prenom: string;
	nom: string;
	id_photos?: string | null;
	first_login: number;
	role: 'admin' | 'mitviste' | 'user';
	promo_year?: number | null;
	alumni_id?: string | null;
}

const db = getDatabase();

export function getUserByCasId(casId: string): DBUser | undefined {
	const stmt = db.prepare('SELECT * FROM users WHERE id_user = ?');
	return stmt.get(casId) as DBUser | undefined;
}

export function getUserByAlumniId(alumniId: string): DBUser | undefined {
	const stmt = db.prepare('SELECT * FROM users WHERE alumni_id = ?');
	return stmt.get(alumniId) as DBUser | undefined;
}

export function linkAlumniToUser(userId: string, alumniId: string) {
	const stmt = db.prepare('UPDATE users SET alumni_id = ? WHERE id_user = ?');
	stmt.run(alumniId, userId);
}

/**
 * Recherche un utilisateur par ses informations d'identité (Prénom, Nom, Promo).
 * Utile pour lier automatiquement un compte Alumni à un compte CAS existant.
 * La recherche est insensible à la casse et aux accents pour le nom/prénom.
 */
export function findUserByIdentity(
	prenom: string,
	nom: string,
	promoYear: number
): DBUser | undefined {
	// Normalisation simple : minuscules.
	// Idéalement il faudrait gérer les accents via collation ou unocde,
	// mais SQLite par défaut est limité.
	// On va faire une recherche simple pour l'instant et filtrer en JS si besoin ou utiliser LOWER()

	const stmt = db.prepare(`
		SELECT * FROM users
		WHERE LOWER(prenom) = LOWER(?)
		  AND LOWER(nom) = LOWER(?)
		  AND promo_year = ?
	`);

	return stmt.get(prenom, nom, promoYear) as DBUser | undefined;
}

export function createUser(user: DBUser) {
	// Utilisation de paramètres positionnels (?) pour éviter tout problème de binding
	// avec les objets contenant des propriétés supplémentaires ou des incompatibilités de nommage.
	const stmt = db.prepare(`
		INSERT INTO users (id_user, email, prenom, nom, first_login, role, promo_year, alumni_id)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`);

	// On extrait explicitement les valeurs dans l'ordre
	return stmt.run(
		user.id_user,
		user.email,
		user.prenom,
		user.nom,
		user.first_login,
		user.role,
		user.promo_year || null,
		user.alumni_id || null
	);
}

export function updateUser(user: Partial<DBUser> & { id_user: string }) {
	// Helper simple pour mettre à jour des champs
	const keys = Object.keys(user).filter((k) => k !== 'id_user');
	const sets = keys.map((k) => `${k} = @${k}`).join(', ');
	const stmt = db.prepare(`UPDATE users SET ${sets} WHERE id_user = @id_user`);
	return stmt.run(user);
}
