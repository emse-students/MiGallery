import { readFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { createRequire } from 'module';
import { createLogger } from '$lib/server/logger';

const DB_PATH = process.env.DATABASE_PATH || './data/migallery.db';
const log = createLogger('db');

type Statement = {
	get: (...params: unknown[]) => unknown;
	all: (...params: unknown[]) => unknown[];
	run: (...params: unknown[]) => { changes: number; lastInsertRowid: number };
};

type DatabaseInstance = {
	prepare: (sql: string) => Statement;
	exec: (sql: string) => void;
	run?: (sql: string) => void;
	close?: () => void;
};

let db: DatabaseInstance | null = null;

/**
 * Apply the canonical schema (src/lib/db/schema.sql) and run idempotent
 * column/table migrations. Safe to call repeatedly: every statement uses
 * CREATE TABLE IF NOT EXISTS / additive ALTERs guarded by PRAGMA checks.
 * Shared by getDatabase() (first-init) and the admin repair endpoint so the
 * two never drift apart.
 */
export function ensureSchema(dbInstance: DatabaseInstance): void {
	const schemaPath = join(process.cwd(), 'src/lib/db/schema.sql');
	const schema = readFileSync(schemaPath, 'utf-8');
	dbInstance.exec(schema);

	try {
		const cols = dbInstance
			.prepare('PRAGMA table_info(users)')
			.all()
			.map((c) => (c as { name: string }).name);
		const hasPrenom = cols.includes('prenom');
		const hasNom = cols.includes('nom');
		const hasEmail = cols.includes('email');
		const hasIdPhotos = cols.includes('id_photos');
		const hasPromoYear = cols.includes('promo_year');
		if (!cols.includes('name')) {
			dbInstance.prepare('ALTER TABLE users ADD COLUMN name TEXT').run();
			if (hasPrenom || hasNom) {
				dbInstance
					.prepare(
						"UPDATE users SET name = trim(COALESCE(prenom, '') || ' ' || COALESCE(nom, '')) WHERE name IS NULL OR name = ''"
					)
					.run();
			}
			if (hasEmail) {
				dbInstance
					.prepare(
						"UPDATE users SET name = COALESCE(name, email, id_user) WHERE name IS NULL OR name = ''"
					)
					.run();
			} else {
				dbInstance
					.prepare("UPDATE users SET name = COALESCE(name, id_user) WHERE name IS NULL OR name = ''")
					.run();
			}
		}
		if (!cols.includes('first_name')) {
			dbInstance.prepare('ALTER TABLE users ADD COLUMN first_name TEXT').run();
			if (hasPrenom) {
				dbInstance
					.prepare(
						'UPDATE users SET first_name = prenom WHERE first_name IS NULL AND prenom IS NOT NULL'
					)
					.run();
			}
		}
		if (!cols.includes('last_name')) {
			dbInstance.prepare('ALTER TABLE users ADD COLUMN last_name TEXT').run();
			if (hasNom) {
				dbInstance
					.prepare('UPDATE users SET last_name = nom WHERE last_name IS NULL AND nom IS NOT NULL')
					.run();
			}
		}
		if (!cols.includes('photos_id')) {
			dbInstance.prepare('ALTER TABLE users ADD COLUMN photos_id TEXT').run();
			if (hasIdPhotos) {
				dbInstance
					.prepare(
						'UPDATE users SET photos_id = id_photos WHERE photos_id IS NULL AND id_photos IS NOT NULL'
					)
					.run();
			}
		}
		if (!cols.includes('role')) {
			dbInstance.prepare("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'").run();
		}
		if (!cols.includes('promo')) {
			dbInstance.prepare('ALTER TABLE users ADD COLUMN promo INTEGER').run();
			if (hasPromoYear) {
				dbInstance
					.prepare('UPDATE users SET promo = promo_year WHERE promo IS NULL AND promo_year IS NOT NULL')
					.run();
			}
		}
		if (!cols.includes('formation')) {
			dbInstance.prepare('ALTER TABLE users ADD COLUMN formation TEXT').run();
		}
		if (!cols.includes('first_login')) {
			dbInstance.prepare('ALTER TABLE users ADD COLUMN first_login INTEGER DEFAULT 1').run();
			// Existing users who already have a promo set don't need the modal
			dbInstance.prepare('UPDATE users SET first_login = 0 WHERE promo IS NOT NULL').run();
		}
		try {
			const acols = dbInstance
				.prepare('PRAGMA table_info(albums)')
				.all()
				.map((c) => (c as { name: string }).name);
			if (acols.length > 0 && !acols.includes('visible')) {
				dbInstance.prepare('ALTER TABLE albums ADD COLUMN visible INTEGER NOT NULL DEFAULT 1').run();
			}
		} catch (_e) {
			try {
				log.warn('migration (albums.visible) notice', (_e as Error).message);
			} catch {
				void _e;
			}
		}
		try {
			const apiKeysExist = dbInstance
				.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='api_keys'")
				.get();
			if (!apiKeysExist) {
				dbInstance
					.prepare(
						`CREATE TABLE api_keys (
									id INTEGER PRIMARY KEY,
          key_hash TEXT NOT NULL UNIQUE,
          label TEXT,
          scopes TEXT,
          revoked INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL
        )`
					)
					.run();
			}
		} catch (_e) {
			try {
				log.warn('migration (api_keys) notice', (_e as Error).message);
			} catch {
				void _e;
			}
		}
		// Unified album permissions (replaces the 4 album_*_permissions tables).
		// user_version 1: one-time backfill from the legacy tables, gated so
		// permissions deleted afterwards are not resurrected on restart.
		// user_version 2 (WP-3a): drop the now-unused legacy tables.
		try {
			dbInstance.exec(
				`CREATE TABLE IF NOT EXISTS album_permissions (
					album_id TEXT NOT NULL,
					kind TEXT NOT NULL,
					value TEXT NOT NULL,
					PRIMARY KEY (album_id, kind, value),
					FOREIGN KEY(album_id) REFERENCES albums(id) ON DELETE CASCADE
				)`
			);
			const uv = (dbInstance.prepare('PRAGMA user_version').get() as { user_version: number })
				.user_version;
			if (uv < 1) {
				const legacyExists = (name: string) =>
					!!dbInstance.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(name);
				if (legacyExists('album_user_permissions')) {
					dbInstance.exec(
						"INSERT OR IGNORE INTO album_permissions (album_id, kind, value) SELECT album_id, 'user', id_user FROM album_user_permissions"
					);
				}
				if (legacyExists('album_tag_permissions')) {
					dbInstance.exec(
						"INSERT OR IGNORE INTO album_permissions (album_id, kind, value) SELECT album_id, 'tag', tag FROM album_tag_permissions"
					);
				}
				if (legacyExists('album_formation_permissions')) {
					dbInstance.exec(
						"INSERT OR IGNORE INTO album_permissions (album_id, kind, value) SELECT album_id, 'formation', formation FROM album_formation_permissions"
					);
				}
				if (legacyExists('album_promo_permissions')) {
					dbInstance.exec(
						"INSERT OR IGNORE INTO album_permissions (album_id, kind, value) SELECT album_id, 'promo', CAST(promo_year AS TEXT) FROM album_promo_permissions"
					);
				}
				dbInstance.exec('PRAGMA user_version = 1');
			}
			// Phase 2 (WP-3a): the backfill above (user_version >= 1) made
			// album_permissions the sole source of truth; no runtime code reads the
			// legacy tables anymore. Drop them once.
			if (uv < 2) {
				dbInstance.exec(
					`DROP TABLE IF EXISTS album_user_permissions;
					DROP TABLE IF EXISTS album_tag_permissions;
					DROP TABLE IF EXISTS album_formation_permissions;
					DROP TABLE IF EXISTS album_promo_permissions;`
				);
				dbInstance.exec('PRAGMA user_version = 2');
			}
		} catch (_e) {
			try {
				log.warn('migration (album_permissions) notice', (_e as Error).message);
			} catch {
				void _e;
			}
		}
	} catch (_e) {
		void _e;
		try {
			log.warn('migration notice', (_e as Error).message);
		} catch {
			void 0;
		}
	}
}

export function getDatabase(): DatabaseInstance {
	if (!db) {
		const dir = dirname(DB_PATH);

		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}

		const require = createRequire(import.meta.url);
		const Database = require('better-sqlite3') as new (path: string) => DatabaseInstance;
		const dbInstance: DatabaseInstance = new Database(DB_PATH) as DatabaseInstance;

		try {
			dbInstance.exec('PRAGMA foreign_keys = ON');
		} catch {
			void 0;
		}

		ensureSchema(dbInstance);

		db = dbInstance;
	}

	return db;
}

export function resetDatabase() {
	if (db) {
		try {
			if (db.close) {
				db.close();
			}
		} catch (e) {
			log.error('error closing database', e);
		}
		db = null;
	}
}
