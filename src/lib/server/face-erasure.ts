/**
 * Undoing a member's face link: what a face withdrawal, an unlink and an account deletion remove.
 *
 * THE CONTRACT (owner decision 2026-10-16). Immich groups EVERY face into anonymous clusters and
 * that is accepted: it is internal, a black box, never shown. What ties a cluster to a human is
 * only what MiGallery writes - `users.photos_id` and `users.photos_asset_id` - plus the person's
 * NAME and birth date in Immich. So the member's link is undone locally and the person's name and
 * birth date are removed in Immich. The cluster itself, its faces and their embeddings stay,
 * unnamed and linked to nobody.
 *
 * TWO HALVES, AND ONLY ONE CAN FAIL. The local half - the `photos_id` link, the profile photo
 * pointer, the on-disk face crops, the photo-access grants in both directions and, for an account
 * deletion, the member's id in the audit log - is MiGallery's own state and is removed inside the
 * request that asked for it ({@link eraseLocalFaceData}, {@link anonymiseUserInLogs}). The remote
 * half (clearing the name in Immich) can fail - Immich down, slow or refusing - so it is written to
 * the `face_erasures` journal in the SAME transaction as the local half, and
 * {@link runFaceErasures} drives it to completion.
 *
 * IDEMPOTENT FROM DURABLE STATE, NOT FROM A CLOCK. A run asks Immich what the person carries NOW,
 * clears it if it is not empty, then reads it back. The timer in {@link startFaceErasureWorker}
 * decides only WHEN the next attempt happens.
 *
 * A FAILURE IS NEVER SILENT. Every failed attempt logs an error with its cause and is counted on
 * the row; any row still pending 24 hours after it was requested is logged as an error on every
 * run, by id, until it completes.
 *
 * WHAT THIS DOES NOT REACH: the cluster's faces and embeddings, and the backups - see
 * docs/wiki/photos-cv.md#erasure.
 */

import { env } from '$env/dynamic/private';
import { getDatabase } from '$lib/db/database';
import { createLogger } from '$lib/server/logger';
import { OUTBOUND_BUDGET_MS } from '$lib/server/outbound';
import { searchAllAssets } from '$lib/server/immich-search';
import { deletePersonFaceCrops } from '$lib/server/face-crop';
import { normalisePersonId } from '$lib/server/person-id';
import { withdrawFaceConsent } from '$lib/server/face-consent';

const log = createLogger('face-erasure');

/** Why the face data goes. */
export type FaceErasureReason = 'withdrawal' | 'account_deletion' | 'relink' | 'admin_unlink';

/** A pending row older than this is reported as an error on every run. */
export const ERASURE_OVERDUE_MS = 24 * 60 * 60 * 1000;
/** How often the worker retries what is still pending. */
const RETRY_INTERVAL_MS = 15 * 60 * 1000;
/** The literal that replaces a deleted member's id in the audit log. */
export const DELETED_ID = '[deleted]';

type Db = ReturnType<typeof getDatabase>;

interface ErasureRow {
  id: number;
  person_id: string | null;
  reason: FaceErasureReason;
  requested_at: number;
  attempts: number;
}

/** What {@link eraseLocalFaceData} decided, for the caller to finish AFTER its commit. */
export interface LocalErasure {
  /** The journal row, or null when no Immich person was linked (or its id is not a person id). */
  erasure: number | null;
  /** The person whose link was undone, for the crop cleanup. */
  personId: string | null;
}

/**
 * The local half for `userId`, inside the caller's transaction: drop the face link and profile
 * photo pointer, the grants the member GAVE (the ones on their own face photos - grants others
 * gave them are about other people's faces and stay), close the consent record, and journal the
 * Immich half when there is a person to clear. The file side (crops, the run) is NOT done here: a
 * file error must not roll a withdrawal back, so the caller runs {@link finishLocalErasure} after
 * its COMMIT. Called for a withdrawal, an account deletion, an admin unlink and a RELINK - the
 * old person's grants and consent never carry over to a different person.
 */
export function eraseLocalFaceData(
  db: Db,
  userId: string,
  reason: FaceErasureReason,
  now: number = Date.now()
): LocalErasure {
  const row = db.prepare('SELECT photos_id FROM users WHERE id_user = ?').get(userId) as {
    photos_id: string | null;
  } | null;
  const linked = row?.photos_id ?? null;

  db.prepare('UPDATE users SET photos_id = NULL, photos_asset_id = NULL WHERE id_user = ?').run(
    userId
  );
  db.prepare('DELETE FROM photo_access_permissions WHERE owner_id = ?').run(userId);
  withdrawFaceConsent(db, userId);

  if (!linked) {
    log.info('face data erased locally, no Immich person was linked', { reason });
    return { erasure: null, personId: null };
  }
  const personId = normalisePersonId(linked);
  if (!personId) {
    // A link an admin stored by hand that is not a person id: nothing in Immich can be named.
    log.warn('face link was not a person id; nothing journaled', { reason });
    return { erasure: null, personId: null };
  }

  const info = db
    .prepare('INSERT INTO face_erasures (person_id, reason, requested_at) VALUES (?, ?, ?)')
    .run(personId, reason, now);
  log.info('face data erased locally, Immich erasure journaled', {
    erasure: info.lastInsertRowid,
    reason,
  });
  return { erasure: Number(info.lastInsertRowid), personId };
}

/** After the COMMIT: delete the person's crops (never throws) and kick the Immich half. */
export function finishLocalErasure(local: LocalErasure): void {
  if (local.personId) {
    deletePersonFaceCrops(local.personId);
  }
  if (local.erasure !== null) {
    kickFaceErasures();
  }
}

/** Start a run and never leave its rejection unhandled. */
export function kickFaceErasures(): void {
  runFaceErasures().catch((e: unknown) => log.error('face erasure run crashed', e));
}

/**
 * Replace a deleted member's id wherever the audit log names them - as the actor, or as the
 * target of a user event (whose details carry their name, so those go too). The events stay, so
 * the log still says WHAT happened; it no longer says to whom.
 */
export function anonymiseUserInLogs(db: Db, userId: string, personId: string | null): void {
  // The address goes with the id: an IP and a timestamp identify a person as well as a name.
  const actor = db
    .prepare('UPDATE logs SET actor = ?, ip = NULL WHERE actor = ?')
    .run(DELETED_ID, userId);
  const target = db
    .prepare(
      "UPDATE logs SET target_id = ?, details = NULL WHERE target_type = 'user' AND target_id = ?"
    )
    .run(DELETED_ID, userId);
  // Any other row whose details name the member (an id inside a JSON blob) loses its details.
  // An EXACT match on the quoted JSON string value: a bare substring would NULL the details of
  // every row naming a longer id that merely contains a short one (`admin`, `member`).
  const inDetails = db
    .prepare("UPDATE logs SET details = NULL WHERE details LIKE ? ESCAPE '!'")
    .run(`%"${userId.replace(/[!%_]/g, (c) => `!${c}`)}"%`).changes;
  let person = 0;
  if (personId) {
    person = db
      .prepare("UPDATE logs SET target_id = ? WHERE target_type = 'person' AND target_id = ?")
      .run(DELETED_ID, personId).changes;
  }
  log.info('audit log anonymised for a deleted account', {
    asActor: actor.changes,
    asTarget: target.changes,
    inDetails,
    asPerson: person,
  });
}

/** Run `fn` in one SQLite transaction. */
export function inTransaction<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/**
 * Delete account `userId` and everything that names it, in one transaction: its face data (the
 * Immich half journaled), its id and address in the audit log, its per-user album grants, then
 * the row - whose foreign keys take its sessions, favorites and remaining grants with it. Kicks
 * the Immich half when there is one.
 * Returns false when there was no such account.
 */
export function deleteUserAccount(db: Db, userId: string): boolean {
  const result = inTransaction(db, () => {
    const row = db.prepare('SELECT photos_id FROM users WHERE id_user = ?').get(userId) as {
      photos_id: string | null;
    } | null;
    if (!row) {
      return null;
    }
    const erasure = eraseLocalFaceData(db, userId, 'account_deletion');
    anonymiseUserInLogs(db, userId, normalisePersonId(row.photos_id));
    // Per-user album grants name the member and carry no foreign key, so they do not cascade.
    db.prepare("DELETE FROM album_permissions WHERE kind = 'user' AND value = ?").run(userId);
    db.prepare('DELETE FROM users WHERE id_user = ?').run(userId);
    return { erasure };
  });
  if (!result) {
    return false;
  }
  finishLocalErasure(result.erasure);
  log.info('account deleted', { erasureJournaled: result.erasure.erasure !== null });
  return true;
}

function immich(): { base: string; key: string } {
  const base = env.IMMICH_BASE_URL?.replace(/\/$/, '');
  if (!base) {
    throw new Error('IMMICH_BASE_URL not configured');
  }
  return { base, key: env.IMMICH_API_KEY ?? '' };
}

async function immichCall(
  fetchFn: typeof fetch,
  method: string,
  path: string,
  body?: unknown
): Promise<Response> {
  const { base, key } = immich();
  return fetchFn(`${base}/api/${path}`, {
    method,
    signal: AbortSignal.timeout(OUTBOUND_BUDGET_MS),
    headers: {
      'x-api-key': key,
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/**
 * The error for a refused Immich call. The response body is deliberately NOT included: Immich
 * echoes the request, and a person's name is what this code exists to remove - it must not end up
 * in `face_erasures.last_error` or the logs.
 */
async function failure(res: Response, what: string): Promise<Error> {
  await res.body?.cancel().catch(() => undefined);
  return new Error(`${what}: ${res.status}`);
}

const SEARCH_PAGE = 500;
const SEARCH_MAX_PAGES = 200;

/** Every asset Immich lists for `personId`, trashed ones included. Throws if the cap is reached. */
async function personAssets(
  fetchFn: typeof fetch,
  personId: string
): Promise<Array<{ id: string }>> {
  const assets = await searchAllAssets(
    fetchFn,
    { personIds: [personId], withDeleted: true },
    { size: SEARCH_PAGE, maxPages: SEARCH_MAX_PAGES }
  );
  if (assets.length >= SEARCH_PAGE * SEARCH_MAX_PAGES) {
    // The search stopped at its cap, so "everything" is not known: do not act as if it were.
    throw new Error('person search reached its page cap');
  }
  return assets;
}

interface PersonIdentity {
  name?: string | null;
  birthDate?: string | null;
}

/**
 * The Immich half for one person: remove its NAME and birth date, then read it back. The cluster
 * and its faces stay (anonymous clusters are accepted). Throws on any Immich refusal, or when the
 * identity is still there after the write - the caller records it and retries later.
 *
 * Immich answers 400 both for "not found" and for "no access", and a 404 may come from anything
 * between us and it, so "absent" is never believed on the status alone: only when a search by
 * that person finds nothing either.
 */
export async function eraseImmichPerson(
  fetchFn: typeof fetch,
  personId: string
): Promise<{ outcome: 'erased' | 'absent' }> {
  const path = `people/${encodeURIComponent(personId)}`;
  const person = await immichCall(fetchFn, 'GET', path);
  if (person.status === 404 || person.status === 400) {
    const left = await personAssets(fetchFn, personId);
    if (left.length > 0) {
      throw new Error(
        `person lookup answered ${person.status} but ${left.length} asset(s) still show it`
      );
    }
    return { outcome: 'absent' };
  }
  if (!person.ok) {
    throw await failure(person, 'person lookup');
  }
  const before = (await person.json()) as PersonIdentity;
  if (!before.name && !before.birthDate) {
    return { outcome: 'erased' };
  }

  const put = await immichCall(fetchFn, 'PUT', path, { name: '', birthDate: null });
  if (!put.ok) {
    throw await failure(put, 'clear the person identity');
  }
  const after = await immichCall(fetchFn, 'GET', path);
  if (!after.ok) {
    throw await failure(after, 'person re-read');
  }
  const check = (await after.json()) as PersonIdentity;
  if (check.name || check.birthDate) {
    throw new Error('the person still carries a name or birth date after the write');
  }
  return { outcome: 'erased' };
}

let running: Promise<void> | null = null;
let rerun = false;

/**
 * Drive every pending erasure. A call made while a run is in progress does not start a second
 * one in parallel; it asks for ONE more pass after it, because the run in progress read the
 * journal before the caller's row existed. NEVER REJECTS (a pass that fails is logged and the next tick retries): each row's failure is logged and
 * recorded on that row, and the next row still runs.
 */
export function runFaceErasures(fetchFn: typeof fetch = fetch): Promise<void> {
  if (running) {
    rerun = true;
    return running;
  }
  running = (async () => {
    do {
      rerun = false;
      try {
        await runOnce(fetchFn);
      } catch (e) {
        log.error('face erasure pass failed', e);
      }
    } while (rerun);
  })().finally(() => {
    running = null;
  });
  return running;
}

async function runOnce(fetchFn: typeof fetch): Promise<void> {
  const db = getDatabase();
  const pending = db
    .prepare(
      'SELECT id, person_id, reason, requested_at, attempts FROM face_erasures WHERE done_at IS NULL ORDER BY id'
    )
    .all() as ErasureRow[];
  if (pending.length === 0) {
    return;
  }
  log.info('face erasures to run', { pending: pending.length });

  for (const row of pending) {
    const now = Date.now();
    try {
      const personId = row.person_id;
      // A row left behind by an earlier link: if the person now belongs to a member, clearing its
      // name or crops would erase someone else's live link. Close the row, touch nothing.
      const relinked = personId
        ? db.prepare('SELECT 1 FROM users WHERE photos_id = ?').get(personId)
        : null;
      if (relinked) {
        db.prepare(
          `UPDATE face_erasures SET done_at = ?, outcome = 'relinked', person_id = NULL, last_error = NULL,
             attempts = attempts + 1, last_attempt_at = ? WHERE id = ?`
        ).run(now, now, row.id);
        log.info('face erasure skipped, person relinked', { erasure: row.id });
        continue;
      }
      const result = personId
        ? await eraseImmichPerson(fetchFn, personId)
        : { outcome: 'absent' as const };

      db.prepare(
        `UPDATE face_erasures SET done_at = ?, outcome = ?, person_id = NULL, last_error = NULL,
           attempts = attempts + 1, last_attempt_at = ?
         WHERE id = ?`
      ).run(now, result.outcome, now, row.id);
      if (personId) {
        // Crops may have been regenerated while the person still carried the link.
        deletePersonFaceCrops(personId);
      }
      log.info('face erasure done', { erasure: row.id, outcome: result.outcome });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      try {
        db.prepare(
          'UPDATE face_erasures SET attempts = attempts + 1, last_attempt_at = ?, last_error = ? WHERE id = ?'
        ).run(now, message.slice(0, 500), row.id);
      } catch (writeErr) {
        log.error('face erasure attempt could not be recorded', writeErr);
      }
      log.error('face erasure attempt failed, will retry', {
        erasure: row.id,
        attempt: row.attempts + 1,
        error: message,
      });
    }
  }

  try {
    reportOverdue(db, Date.now());
  } catch (e) {
    log.error('face erasure overdue report failed', e);
  }
}

/** Log, as an error, every erasure still pending more than {@link ERASURE_OVERDUE_MS} after it was asked. */
export function reportOverdue(db: Db, now: number): number {
  const overdue = db
    .prepare(
      'SELECT id, reason, requested_at, attempts, last_error FROM face_erasures WHERE done_at IS NULL AND requested_at < ?'
    )
    .all(now - ERASURE_OVERDUE_MS) as Array<ErasureRow & { last_error: string | null }>;
  for (const row of overdue) {
    log.error('face erasure OVERDUE: still pending more than 24h after it was requested', {
      erasure: row.id,
      reason: row.reason,
      requestedAt: new Date(row.requested_at).toISOString(),
      attempts: row.attempts,
      lastError: row.last_error,
    });
  }
  return overdue.length;
}

let workerStarted = false;

/**
 * Start the in-process retry loop: once now (to pick up what a restart interrupted), then every
 * 15 minutes. A request that journals an erasure also kicks a run itself, so the timer only
 * matters when Immich failed.
 */
export function startFaceErasureWorker(): void {
  if (workerStarted) {
    return;
  }
  workerStarted = true;
  const tick = () => {
    kickFaceErasures();
  };
  setTimeout(tick, 30_000);
  setInterval(tick, RETRY_INTERVAL_MS);
  log.info('face erasure worker started');
}
