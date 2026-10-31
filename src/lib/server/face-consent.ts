/**
 * The consent record for face matching (`face_consents`, see schema.sql): who agreed, when, to
 * which version of the terms (`TERMS_VERSION`) and how. Written in the same request as the
 * enrolment or the admin link, never reconstructed; closed by a withdrawal.
 */

import type { getDatabase } from '#lib/db/database.ts';
import { createLogger } from '#lib/server/logger.ts';
import { LEGACY_CONSENT_VERSION, TERMS_VERSION } from '#lib/legal.ts';

const log = createLogger('face-consent');

type Db = ReturnType<typeof getDatabase>;

/** How the consent was given. `legacy` is only ever written by {@link backfillLegacyConsents}. */
export type ConsentSource = 'selfie' | 'admin' | 'legacy';

/**
 * Record that `userId` consented to the face link now, under the terms in force. A member who
 * already holds an open (not withdrawn) consent gets no second row.
 */
export function recordFaceConsent(
  db: Db,
  userId: string,
  source: Exclude<ConsentSource, 'legacy'>,
  now: number = Date.now()
): void {
  const open = db
    .prepare('SELECT 1 FROM face_consents WHERE user_id = ? AND withdrawn_at IS NULL')
    .get(userId);
  if (open) {
    return;
  }
  db.prepare(
    'INSERT INTO face_consents (user_id, created_at, version, source) VALUES (?, ?, ?, ?)'
  ).run(userId, now, TERMS_VERSION, source);
  log.info('face consent recorded', { source, version: TERMS_VERSION });
}

/** Mark the member's open consent withdrawn. Returns how many rows it closed. */
export function withdrawFaceConsent(db: Db, userId: string, now: number = Date.now()): number {
  const closed = db
    .prepare('UPDATE face_consents SET withdrawn_at = ? WHERE user_id = ? AND withdrawn_at IS NULL')
    .run(now, userId).changes;
  log.info('face consent withdrawn', { rows: closed });
  return Number(closed);
}

/**
 * One row, `legacy`, for every member who is linked to a person and holds no consent row: those
 * links were consented to by another means, and the owner keeps that proof. Idempotent (runs at
 * every start): a member already holding any row is skipped. `created_at` is the backfill date.
 */
export function backfillLegacyConsents(db: Db, now: number = Date.now()): number {
  const added = db
    .prepare(
      `INSERT INTO face_consents (user_id, created_at, version, source)
       SELECT id_user, ?, ?, 'legacy' FROM users
       WHERE photos_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM face_consents c WHERE c.user_id = users.id_user)`
    )
    .run(now, LEGACY_CONSENT_VERSION).changes;
  if (added > 0) {
    log.info('legacy face consents backfilled', { rows: added });
  }
  return Number(added);
}
