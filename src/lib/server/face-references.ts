/**
 * A member's reference embeddings (`face_references`, see schema.sql): sealed on the way in,
 * opened only here, never returned by a route. The cap of FACE_MAX_REFERENCES is held by the
 * table itself.
 *
 * Since faces v2 (2026-11-01) a reference also records WHERE it came from (the stored face, when
 * it was one) and the CAPTURE DATE of its photo: renewal (face-reference-selection.ts) drops the
 * older of the two most redundant references, so the set follows the member's face over the years.
 */

import type { getDatabase } from '#lib/db/database.ts';
import {
  FACE_MODEL,
  FACE_MAX_REFERENCES,
  decodeEmbedding,
  encodeEmbedding,
} from '#lib/face-embedding.ts';
import type { ReferenceItem } from '#lib/face-reference-selection.ts';
import { referenceContext, seal, unseal } from '#lib/server/face-seal.ts';
import { createLogger } from '#lib/server/logger.ts';

const log = createLogger('face-references');

type Db = ReturnType<typeof getDatabase>;

/**
 * How a reference came to be. `photo` is a face the member confirmed; `matched` an `auto` face
 * proven theirs, chosen by the faces v2 re-selection (face-reference-upgrade.ts); `seed` one the
 * A7 seed chose from the member's own Immich person - told apart so a failed seed's are wiped by
 * the next `begin` without touching any the member gave.
 */
export type ReferenceSource = 'selfie' | 'photo' | 'matched' | 'admin' | 'seed';

/** Where a reference was taken from: a stored face and its photo's capture date (ms). */
export interface ReferenceOrigin {
  assetId?: string | null;
  faceIndex?: number | null;
  takenAt?: number | null;
}

/**
 * Store one reference for `userId`. Returns false, storing nothing, when the member already holds
 * the maximum; the caller decides which one to replace.
 */
export function addFaceReference(
  db: Db,
  key: Buffer,
  userId: string,
  source: ReferenceSource,
  embedding: ArrayLike<number>,
  now: number = Date.now(),
  origin: ReferenceOrigin = {}
): boolean {
  const held = db
    .prepare('SELECT COUNT(*) AS n FROM face_references WHERE user_id = ? AND model = ?')
    .get(userId, FACE_MODEL) as { n: number };
  if (held.n >= FACE_MAX_REFERENCES) {
    log.warn('reference refused: the member holds the maximum', { held: held.n });
    return false;
  }
  const sealed = seal(key, referenceContext(userId, FACE_MODEL), encodeEmbedding(embedding));
  db.prepare(
    `INSERT INTO face_references (user_id, model, source, sealed, created_at, asset_id, face_index,
       taken_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    userId,
    FACE_MODEL,
    source,
    sealed,
    now,
    origin.assetId ?? null,
    origin.faceIndex ?? null,
    origin.takenAt ?? null
  );
  log.info('reference stored', { source });
  return true;
}

/** The member's references, opened. Only rows of the current model are returned. */
export function loadFaceReferences(db: Db, key: Buffer, userId: string): Float32Array[] {
  return loadReferenceItems(db, key, userId).map((item) => item.embedding as Float32Array);
}

/** One held reference with what renewal reads; `key` is `ref:<id>`. Biometric: never serialised. */
export interface HeldReference extends ReferenceItem {
  id: number;
  source: string;
  assetId: string | null;
  faceIndex: number | null;
}

/**
 * The member's references of the current model, opened, with their row id, source, origin and
 * capture date. The selfie is the anchor renewal never drops. Throws when a blob fails to open:
 * a member's set is never edited on a partial read.
 */
export function loadReferenceItems(db: Db, key: Buffer, userId: string): HeldReference[] {
  const rows = db
    .prepare(
      `SELECT id, source, sealed, asset_id, face_index, taken_at FROM face_references
        WHERE user_id = ? AND model = ? ORDER BY id`
    )
    .all(userId, FACE_MODEL) as Array<{
    id: number;
    source: string;
    sealed: Uint8Array;
    asset_id: string | null;
    face_index: number | null;
    taken_at: number | null;
  }>;
  log.debug('loading references', { count: rows.length });
  return rows.map((row) => ({
    key: `ref:${row.id}`,
    id: row.id,
    source: row.source,
    anchor: row.source === 'selfie',
    assetId: row.asset_id,
    faceIndex: row.face_index,
    takenAt: row.taken_at,
    embedding: decodeEmbedding(unseal(key, referenceContext(userId, FACE_MODEL), row.sealed)),
  }));
}

/** Delete one reference of `userId` by its row id (renewal). Returns whether a row went. */
export function deleteFaceReference(db: Db, userId: string, id: number): boolean {
  const changes = db
    .prepare('DELETE FROM face_references WHERE id = ? AND user_id = ?')
    .run(id, userId).changes;
  log.debug('reference deleted', { deleted: changes > 0 });
  return changes > 0;
}

/** Delete every reference of the member (withdrawal). Returns how many rows went. */
export function eraseFaceReferences(db: Db, userId: string): number {
  const result = db.prepare('DELETE FROM face_references WHERE user_id = ?').run(userId) as {
    changes: number;
  };
  // The selection marker describes references that no longer exist.
  db.prepare('DELETE FROM face_reference_selection WHERE user_id = ?').run(userId);
  // And so does the ledger of what a selection pass replaced: sealed copies of the same templates.
  db.prepare('DELETE FROM face_reference_ledger WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM face_match_ledger WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM face_avatar_ledger WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM face_rematch_pending WHERE user_id = ?').run(userId);
  log.info('references erased', { count: result.changes });
  return result.changes;
}
