/**
 * A member's reference embeddings (`face_references`, see schema.sql): sealed on the way in,
 * opened only here, never returned by a route. The cap of FACE_MAX_REFERENCES is held by the
 * table itself.
 */

import type { getDatabase } from '#lib/db/database.ts';
import {
  FACE_MODEL,
  FACE_MAX_REFERENCES,
  decodeEmbedding,
  encodeEmbedding,
} from '#lib/face-embedding.ts';
import { referenceContext, seal, unseal } from '#lib/server/face-seal.ts';
import { createLogger } from '#lib/server/logger.ts';

const log = createLogger('face-references');

type Db = ReturnType<typeof getDatabase>;

/** How a reference came to be. */
export type ReferenceSource = 'selfie' | 'photo' | 'admin';

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
  now: number = Date.now()
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
    'INSERT INTO face_references (user_id, model, source, sealed, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(userId, FACE_MODEL, source, sealed, now);
  log.info('reference stored', { source });
  return true;
}

/** The member's references, opened. Only rows of the current model are returned. */
export function loadFaceReferences(db: Db, key: Buffer, userId: string): Float32Array[] {
  const rows = db
    .prepare('SELECT sealed FROM face_references WHERE user_id = ? AND model = ? ORDER BY id')
    .all(userId, FACE_MODEL) as Array<{ sealed: Uint8Array }>;
  log.debug('loading references', { count: rows.length });
  return rows.map((row) =>
    decodeEmbedding(unseal(key, referenceContext(userId, FACE_MODEL), row.sealed))
  );
}

/** Delete every reference of the member (withdrawal). Returns how many rows went. */
export function eraseFaceReferences(db: Db, userId: string): number {
  const result = db.prepare('DELETE FROM face_references WHERE user_id = ?').run(userId) as {
    changes: number;
  };
  log.info('references erased', { count: result.changes });
  return result.changes;
}
