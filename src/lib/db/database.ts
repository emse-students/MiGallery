import { readFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { createRequire } from 'module';

const DB_PATH = process.env.DATABASE_PATH || './data/migallery.db';

// Type-safe database interface (works with both better-sqlite3 and bun:sqlite)
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

// Detect runtime environment
function isBunRuntime(): boolean {
	return typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined';
}

export function getDatabase(): DatabaseInstance {
	if (!db) {
		const dir = dirname(DB_PATH);

		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}

		// Create database with appropriate driver
		let dbInstance: DatabaseInstance;

		// Use createRequire for both Bun and Node.js to avoid ESM issues
		const require = createRequire(import.meta.url);

		if (isBunRuntime()) {
			// Use bun:sqlite (native, built into Bun)
			const { Database } = require('bun:sqlite') as {
				Database: new (path: string) => DatabaseInstance;
			};
			dbInstance = new Database(DB_PATH) as DatabaseInstance;
		} else {
			// Use better-sqlite3 for Node.js
			const Database = require('better-sqlite3') as new (path: string) => DatabaseInstance;
			dbInstance = new Database(DB_PATH) as DatabaseInstance;
		}

		// Ensure foreign key constraints are enabled
		try {
			dbInstance.exec('PRAGMA foreign_keys = ON');
		} catch {
			// ignore if pragma not supported in environment
		}

		const schemaPath = join(process.cwd(), 'src/lib/db/schema.sql');
		const schema = readFileSync(schemaPath, 'utf-8');
		dbInstance.exec(schema);

		// Run simple migrations to add columns if they are missing (keeps existing DBs compatible)
		try {
			const cols = dbInstance
				.prepare('PRAGMA table_info(users)')
				.all()
				.map((c) => (c as { name: string }).name);
			if (!cols.includes('role')) {
				dbInstance.prepare("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'").run();
			}
			if (!cols.includes('promo_year')) {
				dbInstance.prepare('ALTER TABLE users ADD COLUMN promo_year INTEGER').run();
			}
			// add visible column to albums if missing
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
					console.warn('DB migration (albums.visible) notice:', (_e as Error).message);
				} catch {
					void _e;
					// empty
				}
			}
			// Ensure api_keys table exists for external API key management
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
					console.warn('DB migration (api_keys) notice:', (_e as Error).message);
				} catch {
					void _e;
					// empty
				}
			}
		} catch (_e) {
			// If users table doesn't exist yet (fresh DB), ignore - schema.sql will create it
			// If ALTER fails for some reason, log it for debugging
			void _e;
			try {
				console.warn('DB migration notice:', (_e as Error).message);
			} catch {
				// empty
			}
		}

		// Store the initialized database instance
		db = dbInstance;
	}

	// TypeScript assertion: db is guaranteed to be non-null here
	if (!db) {
		throw new Error('Database initialization failed');
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
			console.error('Error closing database:', e);
		}
		db = null;
	}
}
