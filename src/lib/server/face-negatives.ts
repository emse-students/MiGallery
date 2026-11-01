/**
 * A member's NEGATIVE examples (faces v2, the owner's decision of 2026-11-01,
 * docs/wiki/face-matching-option-c.md): the faces they answered "not me" on, sealed like the
 * references (under their own context, face-seal.ts) and capped at FACE_MAX_NEGATIVES.
 *
 * WHAT ONE DOES. A face closer to one of a member's negatives than to their nearest reference is
 * not offered to THAT member (`withheldByNegative`, face-match.ts). A member's negatives never
 * enter another member's decision, so a member rejecting their own true faces only hurts
 * themselves. Withdrawal deletes them with the references (`eraseLocalFaceData`); an account
 * deletion takes them by cascade.
 *
 * AT THE CAP, the most redundant goes: of the two closest negatives, the older answer
 * (`redundantVictim`), so the set keeps covering the different lookalikes rather than ten frames
 * of one.
 */

import type { getDatabase } from '#lib/db/database.ts';
import {
  FACE_MAX_NEGATIVES,
  FACE_MODEL,
  decodeEmbedding,
  encodeEmbedding,
} from '#lib/face-embedding.ts';
import { redundantVictim } from '#lib/face-reference-selection.ts';
import { negativeContext, seal, unseal } from '#lib/server/face-seal.ts';
import type { FaceKey } from '#lib/server/face-store.ts';
import { createLogger } from '#lib/server/logger.ts';

const log = createLogger('face-negatives');

type Db = ReturnType<typeof getDatabase>;

interface NegativeRow {
  id: number;
  user_id: string;
  sealed: Uint8Array;
  created_at: number;
}

function open(key: Buffer, row: NegativeRow): Float32Array {
  return decodeEmbedding(unseal(key, negativeContext(row.user_id, FACE_MODEL), row.sealed));
}

/**
 * Keep `face` as a negative of `userId`, inside the caller's transaction. A face already kept is
 * left as it is; at the cap the most redundant negative (it may be the new one) makes room.
 * Returns whether the face is a negative of theirs afterwards.
 */
export function addFaceNegative(
  db: Db,
  key: Buffer,
  userId: string,
  face: FaceKey,
  embedding: ArrayLike<number>,
  now: number = Date.now()
): boolean {
  const exists = db
    .prepare(
      'SELECT 1 AS x FROM face_negatives WHERE user_id = ? AND model = ? AND asset_id = ? AND face_index = ?'
    )
    .get(userId, FACE_MODEL, face.assetId, face.faceIndex);
  if (exists) {
    return true;
  }
  const rows = db
    .prepare(
      'SELECT id, user_id, sealed, created_at FROM face_negatives WHERE user_id = ? AND model = ? ORDER BY id'
    )
    .all(userId, FACE_MODEL) as NegativeRow[];
  if (rows.length >= FACE_MAX_NEGATIVES) {
    const victim = redundantVictim([
      ...rows.map((r) => ({ key: `neg:${r.id}`, embedding: open(key, r), takenAt: r.created_at })),
      { key: 'new', embedding, takenAt: now },
    ]);
    if (!victim || victim.key === 'new') {
      log.debug('negative not kept: it duplicates a newer one at the cap');
      return false;
    }
    db.prepare('DELETE FROM face_negatives WHERE id = ?').run(Number(victim.key.slice(4)));
    log.debug('the most redundant negative made room');
  }
  const sealed = seal(key, negativeContext(userId, FACE_MODEL), encodeEmbedding(embedding));
  db.prepare(
    `INSERT INTO face_negatives (user_id, model, asset_id, face_index, sealed, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`
  ).run(userId, FACE_MODEL, face.assetId, face.faceIndex, sealed, now);
  log.info('negative example kept');
  return true;
}

/**
 * Every member's negatives of the current model, opened. A member whose blob fails to open is
 * named in `broken`: the engine then does not match them at all, never on a partial set (as
 * for the references).
 */
export function loadAllNegatives(
  db: Db,
  key: Buffer
): { byMember: Map<string, Float32Array[]>; broken: Set<string> } {
  const rows = db
    .prepare(
      'SELECT id, user_id, sealed, created_at FROM face_negatives WHERE model = ? ORDER BY user_id, id'
    )
    .all(FACE_MODEL) as NegativeRow[];
  const byMember = new Map<string, Float32Array[]>();
  const broken = new Set<string>();
  for (const row of rows) {
    if (broken.has(row.user_id)) {
      continue;
    }
    try {
      const list = byMember.get(row.user_id) ?? [];
      list.push(open(key, row));
      byMember.set(row.user_id, list);
    } catch {
      broken.add(row.user_id);
      byMember.delete(row.user_id);
      log.error('a member negative failed to open; the member is not matched', {
        userId: row.user_id,
      });
    }
  }
  return { byMember, broken };
}

/** How many negatives `userId` holds (the current model). */
export function negativeCount(db: Db, userId: string): number {
  return (
    db
      .prepare('SELECT COUNT(*) AS n FROM face_negatives WHERE user_id = ? AND model = ?')
      .get(userId, FACE_MODEL) as { n: number }
  ).n;
}

/**
 * Delete the negative `userId` kept for `face` (their "not me" taken back), inside the caller's
 * transaction. Returns how many rows went: 0 when none was kept (the cap had dropped it).
 */
export function deleteFaceNegative(db: Db, userId: string, face: FaceKey): number {
  return db
    .prepare(
      'DELETE FROM face_negatives WHERE user_id = ? AND model = ? AND asset_id = ? AND face_index = ?'
    )
    .run(userId, FACE_MODEL, face.assetId, face.faceIndex).changes;
}

/** Delete every negative of the member (withdrawal). Returns how many rows went. */
export function eraseFaceNegatives(db: Db, userId: string): number {
  const changes = db.prepare('DELETE FROM face_negatives WHERE user_id = ?').run(userId).changes;
  log.info('negatives erased', { count: changes });
  return changes;
}
