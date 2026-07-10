import { json } from '@sveltejs/kit';
import { getDatabase, ensureSchema } from '$lib/db/database';
import type { RequestHandler } from '@sveltejs/kit';

// Canonical table set, kept in sync with src/lib/db/schema.sql.
const REQUIRED_TABLES = [
	'users',
	'albums',
	'album_user_permissions',
	'album_tag_permissions',
	'album_formation_permissions',
	'album_promo_permissions',
	'user_favorites',
	'photo_access_permissions',
	'logs',
	'api_keys'
];

/**
 * GET - Inspect the database structure and report missing canonical tables.
 */
export const GET: RequestHandler = () => {
	try {
		const db = getDatabase();

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
			missingTables
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
 * POST - Create/repair missing tables by re-applying the canonical schema.
 * Delegates to ensureSchema() so this endpoint can never drift from
 * src/lib/db/schema.sql (previously it hand-wrote a stale, divergent schema).
 */
export const POST: RequestHandler = () => {
	try {
		const db = getDatabase();

		ensureSchema(db);

		const existingTables = db
			.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
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

		return json({
			success: missingTables.length === 0,
			message:
				missingTables.length === 0
					? 'Schema applied; all canonical tables present.'
					: `Schema applied but tables still missing: ${missingTables.join(', ')}`,
			newStatus: tableStatus,
			missingTables
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
