/**
 * The sealed face store, read side (lot A2, docs/wiki/face-matching-option-c.md): the key, every
 * member's references, and a full scan of `face_embeddings`.
 *
 * THE STORE IS STREAMED, NEVER HELD. A scan reads the table chunk by chunk, opens each blob, compares
 * it and drops it: the measured cost of a full scan of 600k faces is seconds, while holding the
 * decoded store resident would keep about 0.6 GB of third parties' templates in the server's
 * memory for the sake of an enrolment a day (measurements on the wiki page). Nothing here caches
 * a template between calls.
 */

import type { getDatabase } from '#lib/db/database.ts';
import { env } from '#lib/server/env.ts';
import { FACE_MODEL, decodeEmbedding } from '#lib/face-embedding.ts';
import { embeddingContext, parseSealKey, referenceContext, unseal } from '#lib/server/face-seal.ts';
import type { MemberReferences } from '#lib/face-match.ts';
import { createLogger } from '#lib/server/logger.ts';

const log = createLogger('face-store');

type Db = ReturnType<typeof getDatabase>;

/** The store key, or a throw when the secret is missing or malformed (never a weaker key). */
export function faceStoreKey(): Buffer {
  return parseSealKey(env.FACE_STORE_KEY);
}

/** Whether the store can run at all: its key and the model service are configured. */
export function faceStoreConfigured(): boolean {
  return !!env.FACE_STORE_KEY && !!env.FACE_ML_URL;
}

/**
 * Every member's references of the current model, opened, grouped by member. A blob that fails to
 * open is logged (by face-seal) and skips that member entirely: a member is never matched on a
 * partial set they did not choose.
 */
export function loadAllReferences(db: Db, key: Buffer): MemberReferences[] {
  const rows = db
    .prepare('SELECT user_id, sealed FROM face_references WHERE model = ? ORDER BY user_id, id')
    .all(FACE_MODEL) as Array<{ user_id: string; sealed: Uint8Array }>;
  const byMember = new Map<string, Float32Array[]>();
  const broken = new Set<string>();
  for (const row of rows) {
    if (broken.has(row.user_id)) {
      continue;
    }
    try {
      const refs = byMember.get(row.user_id) ?? [];
      refs.push(
        decodeEmbedding(unseal(key, referenceContext(row.user_id, FACE_MODEL), row.sealed))
      );
      byMember.set(row.user_id, refs);
    } catch {
      broken.add(row.user_id);
      byMember.delete(row.user_id);
      log.error('a member reference failed to open; the member is not matched', {
        userId: row.user_id,
      });
    }
  }
  return [...byMember].map(([userId, refs]) => ({ userId, refs }));
}

/** The key of one stored face. */
export interface FaceKey {
  assetId: string;
  faceIndex: number;
}

/** Rows read per chunk of a scan; the event loop gets the hand back between two chunks. */
export const SCAN_CHUNK = 2000;

/**
 * Visit every stored face of the current model with its opened embedding, in physical order.
 * A blob that fails to open is counted and skipped (face-seal logs it). Returns how many faces
 * were visited and how many failed.
 *
 * ASYNC ON PURPOSE. `bun:sqlite` is synchronous and a full scan is seconds (6.5 s for 600,000
 * faces): read in one go it would freeze every request of the server for that long. It reads
 * {@link SCAN_CHUNK} rows by rowid, then yields, so a page load waits one chunk at most.
 */
export async function scanFaceStore(
  db: Db,
  key: Buffer,
  visit: (face: FaceKey, embedding: Float32Array) => void
): Promise<{ visited: number; failed: number }> {
  const chunk = db.prepare(
    `SELECT rowid AS rid, asset_id, face_index, sealed FROM face_embeddings
      WHERE model = ? AND rowid > ? ORDER BY rowid LIMIT ?`
  );
  let visited = 0;
  let failed = 0;
  let after = 0;
  for (;;) {
    const rows = chunk.all(FACE_MODEL, after, SCAN_CHUNK) as Array<{
      rid: number;
      asset_id: string;
      face_index: number;
      sealed: Uint8Array;
    }>;
    for (const row of rows) {
      let embedding: Float32Array;
      try {
        embedding = decodeEmbedding(
          unseal(key, embeddingContext(row.asset_id, row.face_index, FACE_MODEL), row.sealed)
        );
      } catch {
        failed++;
        continue;
      }
      visited++;
      visit({ assetId: row.asset_id, faceIndex: row.face_index }, embedding);
    }
    if (rows.length < SCAN_CHUNK) {
      break;
    }
    after = rows[rows.length - 1].rid;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  if (failed > 0) {
    log.error('stored faces failed to open during a scan', { failed, visited });
  }
  return { visited, failed };
}

/** Open the stored embeddings of the given faces (missing or unopenable ones are left out). */
export function loadFaceEmbeddings(
  db: Db,
  key: Buffer,
  faces: ReadonlyArray<FaceKey>
): Array<FaceKey & { embedding: Float32Array }> {
  const get = db.prepare(
    'SELECT sealed FROM face_embeddings WHERE asset_id = ? AND face_index = ? AND model = ?'
  );
  const out: Array<FaceKey & { embedding: Float32Array }> = [];
  let failed = 0;
  for (const face of faces) {
    const row = get.get(face.assetId, face.faceIndex, FACE_MODEL) as { sealed: Uint8Array } | null;
    if (!row) {
      continue;
    }
    try {
      out.push({
        ...face,
        embedding: decodeEmbedding(
          unseal(key, embeddingContext(face.assetId, face.faceIndex, FACE_MODEL), row.sealed)
        ),
      });
    } catch {
      failed++;
    }
  }
  if (failed > 0) {
    log.error('stored faces failed to open', { failed });
  }
  return out;
}
