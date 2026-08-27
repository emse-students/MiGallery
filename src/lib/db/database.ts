import { readFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { createRequire } from 'module';
import { createLogger } from '$lib/server/logger';

const DB_PATH = process.env.DATABASE_PATH || './data/migallery.db';
const log = createLogger('db');

type Statement = {
  /**
   * Returns `null` - NOT `undefined` - when no row matches. That is `bun:sqlite`'s contract and it
   * differs from better-sqlite3, which this used to be. Truthiness checks, `??` and `?.` behave
   * identically across the two; a strict `=== undefined` would not. There are none in `src/`, and
   * that was checked rather than assumed when the driver was swapped.
   */
  get: (...params: unknown[]) => unknown;
  all: (...params: unknown[]) => unknown[];
  run: (...params: unknown[]) => { changes: number; lastInsertRowid: number };
};

type DatabaseInstance = {
  prepare: (sql: string) => Statement;
  exec: (sql: string) => void;
  run?: (sql: string) => void;
  /**
   * `bun:sqlite` closes LAZILY by default: with prepared statements still outstanding, `close()`
   * returns having left the file open. Pass `true` to close immediately. On Windows that is the
   * difference between being able to delete the file and `EBUSY`; everywhere it is the difference
   * between releasing the handle and leaking it until GC.
   */
  close?: (throwOnError?: boolean) => void;
};

let db: DatabaseInstance | null = null;

/**
 * Reject an object bind whose keys are not sigil-prefixed, before it reaches the driver.
 *
 * better-sqlite3 accepted `@promo` in the SQL bound from `{ promo: 2025 }` and THREW when a named
 * parameter had no key. `bun:sqlite` does neither: the key must carry the same sigil as the
 * placeholder (`{ '@promo': 2025 }`), a bare key matches nothing and the statement runs having
 * bound NOTHING - `changes: 0`, no error - and a key that is merely absent binds NULL and reports
 * `changes: 1`. Both were measured. A driver swap therefore turns "this row was updated" into
 * "this row was silently skipped" or "this column was silently erased", with nothing logged.
 *
 * Nothing in `src/` binds by name any more, so this is not load-bearing today; it exists so that
 * reintroducing the pattern fails LOUDLY at the call site instead of corrupting a row months later.
 * Sigil-prefixed keys pass through untouched - the feature is available, just not by accident.
 */
const PARAM_SIGILS = ['@', ':', '$'];

function assertNoBareKeyedBind(sql: string, params: unknown[]): void {
  if (params.length !== 1) {
    return;
  }
  const only = params[0];
  if (only === null || typeof only !== 'object') {
    return;
  }
  // A single BLOB, Date or array argument is a positional value, not a bind map.
  if (Array.isArray(only) || ArrayBuffer.isView(only) || only instanceof Date) {
    return;
  }

  const bare = Object.keys(only).filter((key) => !PARAM_SIGILS.includes(key.charAt(0)));
  if (bare.length === 0) {
    return;
  }

  throw new Error(
    `SQLite bind rejected: keys [${bare.join(', ')}] have no '@', ':' or '$' prefix. ` +
      `bun:sqlite matches an object key to a placeholder only when the sigils match, and binds ` +
      `nothing at all otherwise - silently. Prefix the keys to match the SQL, or use positional ` +
      `'?' parameters. SQL: ${sql}`
  );
}

/**
 * Wrap a driver statement so every bind goes through {@link assertNoBareKeyedBind} first.
 */
function guardStatement(sql: string, stmt: Statement): Statement {
  return {
    get: (...params: unknown[]) => {
      assertNoBareKeyedBind(sql, params);
      return stmt.get(...params);
    },
    all: (...params: unknown[]) => {
      assertNoBareKeyedBind(sql, params);
      return stmt.all(...params);
    },
    run: (...params: unknown[]) => {
      assertNoBareKeyedBind(sql, params);
      return stmt.run(...params);
    },
  };
}

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
          .prepare(
            "UPDATE users SET name = COALESCE(name, id_user) WHERE name IS NULL OR name = ''"
          )
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
          .prepare(
            'UPDATE users SET promo = promo_year WHERE promo IS NULL AND promo_year IS NOT NULL'
          )
          .run();
      }
    }
    if (!cols.includes('formation')) {
      dbInstance.prepare('ALTER TABLE users ADD COLUMN formation TEXT').run();
    }
    // `first_login` gated a modal that asked the user for their own graduation year. Authentik
    // carries that claim for every account it describes - 277 of the 280 on prod - and for the
    // staff accounts it does not describe, the modal wrote NULL over NULL: its only effect was
    // to stop showing itself. It was also the one place where a user could CHOOSE a promo, and
    // a promo is an album-access key, so removing it leaves the SSO as its only writer.
    if (cols.includes('first_login')) {
      dbInstance.prepare('ALTER TABLE users DROP COLUMN first_login').run();
    }
    if (!cols.includes('locale')) {
      dbInstance.prepare('ALTER TABLE users ADD COLUMN locale TEXT').run();
    }
    if (!cols.includes('photos_asset_id')) {
      dbInstance.prepare('ALTER TABLE users ADD COLUMN photos_asset_id TEXT').run();
    }
    try {
      const acols = dbInstance
        .prepare('PRAGMA table_info(albums)')
        .all()
        .map((c) => (c as { name: string }).name);
      if (acols.length > 0 && !acols.includes('visible')) {
        dbInstance
          .prepare('ALTER TABLE albums ADD COLUMN visible INTEGER NOT NULL DEFAULT 1')
          .run();
      }
      // Persisted album cover: resolved once from the media backend, then
      // read from here. NULL rows are resolved lazily on first request.
      if (acols.length > 0 && !acols.includes('cover_asset_id')) {
        dbInstance.prepare('ALTER TABLE albums ADD COLUMN cover_asset_id TEXT').run();
      }
      if (acols.length > 0 && !acols.includes('cover_asset_type')) {
        dbInstance.prepare('ALTER TABLE albums ADD COLUMN cover_asset_type TEXT').run();
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
          !!dbInstance
            .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?")
            .get(name);
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

    // `createRequire` rather than a static import: `bun:sqlite` is a runtime builtin with no file
    // on disk, and a static import would make vite try to resolve and bundle it at build time.
    // Requiring it keeps the resolution where it belongs - in the runtime that provides it.
    const require = createRequire(import.meta.url);
    const { Database } = require('bun:sqlite') as {
      Database: new (path: string) => DatabaseInstance;
    };
    const driver: DatabaseInstance = new Database(DB_PATH) as DatabaseInstance;
    // Every statement in the app is prepared through here, so the bind guard has no way around it.
    const dbInstance: DatabaseInstance = {
      ...driver,
      prepare: (sql: string) => guardStatement(sql, driver.prepare(sql)),
      exec: (sql: string) => driver.exec(sql),
      close: (throwOnError?: boolean) => driver.close?.(throwOnError ?? true),
    };

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
        // `true`: close now rather than when the last statement is collected. A lazy close here
        // means the next getDatabase() can open a second handle to a file the first still holds.
        db.close(true);
      }
    } catch (e) {
      log.error('error closing database', e);
    }
    db = null;
  }
}
