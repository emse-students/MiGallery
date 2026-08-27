import { getDatabase } from '$lib/db/database';

export interface DBUser {
  id_user: string;
  name: string;
  first_name?: string | null;
  last_name?: string | null;
  photos_id?: string | null;
  photos_asset_id?: string | null;
  role: 'admin' | 'mitviste' | 'user';
  promo?: number | null;
  formation?: string | null;
  locale?: string | null;
}

export function getUserByCasId(casId: string): DBUser | undefined {
  const db = getDatabase();
  const stmt = db.prepare('SELECT * FROM users WHERE id_user = ?');
  return stmt.get(casId) as DBUser | undefined;
}

export function createUser(user: DBUser) {
  const db = getDatabase();
  const stmt = db.prepare(`
		INSERT INTO users (id_user, name, first_name, last_name, photos_id, role, promo, formation)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`);

  return stmt.run(
    user.id_user,
    user.name,
    user.first_name || null,
    user.last_name || null,
    user.photos_id || null,
    user.role,
    user.promo || null,
    user.formation || null
  );
}

/**
 * Update the columns present on `user`, leaving every other column alone.
 *
 * Positional `?` parameters, NOT the `@name` form this used to carry. Under better-sqlite3 a named
 * parameter with no matching key threw; under `bun:sqlite` it binds NULL and reports `changes: 1`,
 * so a key that went missing here would have silently WIPED that column instead of failing. The
 * SET clause is built from `Object.keys`, which is precisely the shape where that happens.
 * `getDatabase()` refuses bare-keyed object binds for the same reason.
 */
export function updateUser(user: Partial<DBUser> & { id_user: string }) {
  const db = getDatabase();
  const keys = Object.keys(user).filter((k) => k !== 'id_user');
  if (keys.length === 0) {
    // No column to write. The alternative is `UPDATE users SET  WHERE ...`, a syntax error.
    return { changes: 0, lastInsertRowid: 0 };
  }

  const values = keys.map((k) => {
    const value = user[k as keyof DBUser];
    if (value === undefined) {
      // better-sqlite3 threw here and callers were written against that. `bun:sqlite` would bind
      // NULL instead, turning "I forgot to set this field" into "erase this column".
      throw new Error(
        `updateUser: column '${k}' was passed as undefined. Pass null to clear it, or omit the key to leave it alone.`
      );
    }
    return value;
  });

  const sets = keys.map((k) => `${k} = ?`).join(', ');
  const stmt = db.prepare(`UPDATE users SET ${sets} WHERE id_user = ?`);
  return stmt.run(...values, user.id_user);
}
