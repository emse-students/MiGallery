import { json } from '@sveltejs/kit';
import { getDatabase } from '$lib/db/database';
import type { RequestHandler } from '@sveltejs/kit';

const REQUIRED_TABLES = [
	'users',
	'albums',
	'album_user_permissions',
	'album_tag_permissions',
	'user_favorites'
];

/**
 * GET - Inspecter la structure de la base de données
 */
export const GET: RequestHandler = () => {
	try {
		const db = getDatabase();

		// Vérifier les tables existantes
		const existingTables = db
			.prepare(
				"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
			)
			.all() as { name: string }[];

		const existingTableNames = new Set(existingTables.map((t) => t.name));

		const tableStatus = REQUIRED_TABLES.map((table) => ({
			name: table,
			exists: existingTableNames.has(table),
			rowCount: existingTableNames.has(table)
				? (db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as { count: number }).count
				: 0
		}));

		const missingTables = tableStatus.filter((t) => !t.exists).map((t) => t.name);
		const allTablesPresent = missingTables.length === 0;

		return json({
			success: true,
			status: allTablesPresent ? 'healthy' : 'incomplete',
			totalTables: existingTables.length,
			requiredTables: REQUIRED_TABLES.length,
			tables: tableStatus,
			missingTables,
			allTables: existingTableNames.has('user_favorites') // Pour debug
		});
	} catch (e) {
		return json(
			{
				success: false,
				error: (e as Error).message
			},
			{ status: 500 }
		);
	}
};

/**
 * POST - Créer/réparer les tables manquantes
 */
export const POST: RequestHandler = () => {
	try {
		const db = getDatabase();

		const migrations = [
			{
				name: 'users',
				sql: `CREATE TABLE IF NOT EXISTS users (
          id_user TEXT PRIMARY KEY,
          email TEXT NOT NULL,
          prenom TEXT NOT NULL,
          nom TEXT NOT NULL,
          id_photos TEXT,
          first_login INTEGER DEFAULT 1,
          role TEXT DEFAULT 'user',
          promo_year INTEGER
        )`
			},
			{
				name: 'albums',
				sql: `CREATE TABLE IF NOT EXISTS albums (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          date TEXT,
          location TEXT,
          visibility TEXT NOT NULL DEFAULT 'authenticated',
          visible INTEGER NOT NULL DEFAULT 1
        )`
			},
			{
				name: 'album_user_permissions',
				sql: `CREATE TABLE IF NOT EXISTS album_user_permissions (
          album_id TEXT NOT NULL,
          id_user TEXT NOT NULL,
          PRIMARY KEY (album_id, id_user),
          FOREIGN KEY(album_id) REFERENCES albums(id) ON DELETE CASCADE
        )`
			},
			{
				name: 'album_tag_permissions',
				sql: `CREATE TABLE IF NOT EXISTS album_tag_permissions (
          album_id TEXT NOT NULL,
          tag TEXT NOT NULL,
          PRIMARY KEY (album_id, tag),
          FOREIGN KEY(album_id) REFERENCES albums(id) ON DELETE CASCADE
        )`
			},
			{
				name: 'user_favorites',
				sql: `CREATE TABLE IF NOT EXISTS user_favorites (
          user_id TEXT NOT NULL,
          asset_id TEXT NOT NULL,
          created_at TEXT DEFAULT (datetime('now')),
          PRIMARY KEY (user_id, asset_id),
          FOREIGN KEY(user_id) REFERENCES users(id_user) ON DELETE CASCADE
        )`
			}
		];

		const results: Array<{ table: string; success: boolean; message: string }> = [];

		for (const migration of migrations) {
			try {
				db.exec(migration.sql);
				results.push({
					table: migration.name,
					success: true,
					message: 'Créée ou vérifiée'
				});
			} catch (err) {
				results.push({
					table: migration.name,
					success: false,
					message: (err as Error).message
				});
			}
		}

		// Revérifier l'état après les migrations
		const tableStatus = REQUIRED_TABLES.map((table) => ({
			name: table,
			exists: true, // Si on arrive ici, toutes les tables doivent exister
			rowCount: (db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as { count: number }).count
		}));

		return json({
			success: true,
			message: 'Migration terminée',
			results,
			newStatus: tableStatus
		});
	} catch (e) {
		return json(
			{
				success: false,
				error: (e as Error).message
			},
			{ status: 500 }
		);
	}
};
