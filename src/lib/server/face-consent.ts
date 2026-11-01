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
 * Record that `userId` consented to the face link now, under the terms in force. MUST run inside
 * the caller's transaction (the one writing what the consent covers).
 *
 * - `selfie` is the MEMBER's own explicit agreement (they ticked it): it SUPERSEDES any other open
 *   row - a `legacy` or `admin` row, or a `selfie` row on older terms - which is closed and a
 *   `selfie` row on TERMS_VERSION opened. Only an open `selfie` row already on TERMS_VERSION is
 *   kept as it is: a re-enrolment under the same terms says nothing new, so no rows churn.
 * - `admin` is an administrator's link, not the member's agreement: it never replaces an open row
 *   (above all not the member's own `selfie` one), and opens one only when none is open.
 */
export function recordFaceConsent(
  db: Db,
  userId: string,
  source: Exclude<ConsentSource, 'legacy'>,
  now: number = Date.now()
): void {
  const open = db
    .prepare(
      'SELECT id, source, version FROM face_consents WHERE user_id = ? AND withdrawn_at IS NULL'
    )
    .all(userId) as Array<{ id: number; source: string; version: string }>;
  if (source === 'admin' && open.length > 0) {
    log.debug('admin link: an open consent is kept', { sources: open.map((r) => r.source) });
    return;
  }
  if (source === 'selfie' && open.length > 0) {
    if (open.every((r) => r.source === 'selfie' && r.version === TERMS_VERSION)) {
      log.debug('selfie consent already open on the terms in force');
      return;
    }
    const closed = db
      .prepare(
        'UPDATE face_consents SET withdrawn_at = ? WHERE user_id = ? AND withdrawn_at IS NULL'
      )
      .run(now, userId).changes;
    log.info("an older consent is superseded by the member's own agreement", {
      closed,
      sources: open.map((r) => r.source),
    });
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
