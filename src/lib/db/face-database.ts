/**
 * The face store's own SQLite file, `faces.db`, beside `migallery.db` (lot A3,
 * docs/wiki/face-matching-option-c.md).
 *
 * WHY A SECOND FILE. It holds one sealed embedding per detected face - everyone photographed,
 * non-members included - and the decision of 2026-10-24 is that those templates stay out of every
 * backup: they are recomputed from the photographs. The in-app backup copies `DATABASE_PATH` and
 * the offsite script copies `migallery.db`; neither names this file, so neither ever holds a
 * third party's template. What concerns consenting members (references, matches, consent) stays
 * in `migallery.db`.
 *
 * Losing this file loses nothing that cannot be recomputed: `face_store_state` goes with it, so
 * ingestion stops ("not seeded") until the store is seeded again or marked empty, after which every
 * asset is embedded again by the model: about 22 hours of the model service once Immich no longer
 * holds the vectors (after A8).
 */

import { join, dirname } from 'path';
import { openSqliteFile, type DatabaseInstance } from '#lib/db/database.ts';
import { createLogger } from '#lib/server/logger.ts';

const log = createLogger('face-db');

/**
 * The schema, here rather than in a .sql file: the image copies only `schema.sql`, and this file
 * has no history to migrate from. Any change to a table after a release needs a guarded step.
 *
 * face_embeddings: one sealed float16 512-d embedding per detected face, its box in pixels of the
 * image the model saw (`img_w` x `img_h`), and the detector's score - NULL for a face seeded from
 * Immich, which keeps no score. `model` is part of the key so a re-embedding by a new model can
 * sit beside the old rows.
 *
 * face_assets: the durable ingestion state of each asset: `pending` (to embed), `done` (its faces
 * are in face_embeddings, `faces` of them, written by `source`), `failed` (gave up after the
 * attempts; reported every hour until someone looks). `absent_listings` counts the consecutive
 * complete Immich listings the asset was missing from; its faces go at two.
 *
 * face_store_state: a few named facts (`seeded_at`).
 */
const FACE_SCHEMA = `
CREATE TABLE IF NOT EXISTS face_embeddings (
    asset_id TEXT NOT NULL,
    face_index INTEGER NOT NULL,
    model TEXT NOT NULL,
    x1 REAL NOT NULL,
    y1 REAL NOT NULL,
    x2 REAL NOT NULL,
    y2 REAL NOT NULL,
    img_w INTEGER NOT NULL,
    img_h INTEGER NOT NULL,
    score REAL,
    sealed BLOB NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY(asset_id, face_index, model)
);
CREATE TABLE IF NOT EXISTS face_assets (
    asset_id TEXT NOT NULL,
    model TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('pending', 'done', 'failed')),
    source TEXT CHECK (source IN ('ml', 'seed')),
    faces INTEGER,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    absent_listings INTEGER NOT NULL DEFAULT 0,
    discovered_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY(asset_id, model)
);
CREATE INDEX IF NOT EXISTS idx_face_assets_state ON face_assets(state, discovered_at);
CREATE TABLE IF NOT EXISTS face_store_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
`;

let faceDb: DatabaseInstance | null = null;

/** Where the file lives: `FACE_DATABASE_PATH`, else `faces.db` beside `migallery.db`. */
export function faceDatabasePath(): string {
  if (process.env.FACE_DATABASE_PATH) {
    return process.env.FACE_DATABASE_PATH;
  }
  const main = process.env.DATABASE_PATH || './data/migallery.db';
  return join(dirname(main), 'faces.db');
}

/** The face store's database, opened (and its schema applied) on first use. */
export function getFaceDatabase(): DatabaseInstance {
  if (!faceDb) {
    const instance = openSqliteFile(faceDatabasePath());
    try {
      instance.exec('PRAGMA journal_mode = WAL');
    } catch (e) {
      log.warn('faces.db could not switch to WAL', (e as Error).message);
    }
    instance.exec(FACE_SCHEMA);
    faceDb = instance;
  }
  return faceDb;
}

/** Close the file (tests, shutdown). */
export function resetFaceDatabase(): void {
  if (faceDb) {
    try {
      faceDb.close?.(true);
    } catch (e) {
      log.error('error closing faces.db', e);
    }
    faceDb = null;
  }
}

/** A named fact of the store, or null. */
export function getFaceStoreState(db: DatabaseInstance, key: string): string | null {
  const row = db.prepare('SELECT value FROM face_store_state WHERE key = ?').get(key) as {
    value: string;
  } | null;
  return row?.value ?? null;
}

/** Write a named fact of the store. */
export function setFaceStoreState(db: DatabaseInstance, key: string, value: string): void {
  db.prepare(
    'INSERT INTO face_store_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value);
}
