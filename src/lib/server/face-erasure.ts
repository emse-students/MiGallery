/**
 * Erasing a member's face data: what a face withdrawal and an account deletion must remove.
 *
 * TWO HALVES, AND ONLY ONE CAN FAIL. The local half - the `photos_id` link, the profile photo
 * pointer, the on-disk face crops, the photo-access grants in both directions and, for an account
 * deletion, the member's id in the audit log - is MiGallery's own state and is removed inside the
 * request that asked for it ({@link eraseLocalFaceData}, {@link anonymiseUserInLogs}). The remote
 * half lives in Immich: the face records of that person on every asset (each one carries the
 * face's embedding, the biometric vector) and then the person itself. Immich can be down, slow or
 * refuse, so that half is written to the `face_erasures` journal in the SAME transaction as the
 * local half, and {@link runFaceErasures} drives it to completion.
 *
 * IDEMPOTENT FROM DURABLE STATE, NOT FROM A CLOCK. A run asks Immich what is still there - the
 * person, the assets it appears in, the faces on each asset that still point at it - and deletes
 * exactly that. A run cut short leaves fewer faces for the next one; the person is deleted only
 * after every face of it is gone, so the list of faces stays findable until the end. The timer in
 * {@link startFaceErasureWorker} decides only WHEN the next attempt happens, never whether the
 * work is done.
 *
 * A FAILURE IS NEVER SILENT. Every failed attempt logs an error with its cause and is counted on
 * the row; any row still pending 24 hours after it was requested is logged as an error on every
 * run, by id, until it completes.
 *
 * WHAT THIS DOES NOT REACH: backups. The local MiGallery snapshots (last 10), the off-site
 * MiGallery copies (14 days) and the off-site Immich dumps (7 days) still hold the data until they
 * rotate out - see
 * docs/wiki/photos-cv.md#erasure. And faces Immich detects AGAIN later (a full re-run of its face
 * detection job) are new records this journal never saw.
 */

import { env } from '$env/dynamic/private';
import { getDatabase } from '$lib/db/database';
import { createLogger } from '$lib/server/logger';
import { OUTBOUND_BUDGET_MS } from '$lib/server/outbound';
import { searchAllAssets } from '$lib/server/immich-search';
import { deletePersonFaceCrops } from '$lib/server/face-crop';

const log = createLogger('face-erasure');

/** Why the face data goes. */
export type FaceErasureReason = 'withdrawal' | 'account_deletion';

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

interface ImmichFace {
  id: string;
  person?: { id?: string } | null;
}

/**
 * The local half for `userId`, inside the caller's transaction: drop the face link and profile
 * photo pointer, the grants in both directions and the on-disk crops, and journal the Immich half
 * when there is a person to erase. Returns the journal row id, or null when the member had no
 * linked person.
 *
 * The crops are files, not rows, so a rollback cannot restore them - which is harmless: they are
 * a cache, regenerated from Immich on demand while the link still exists.
 */
export function eraseLocalFaceData(
  db: Db,
  userId: string,
  reason: FaceErasureReason,
  now: number = Date.now()
): number | null {
  const row = db.prepare('SELECT photos_id FROM users WHERE id_user = ?').get(userId) as {
    photos_id: string | null;
  } | null;
  const personId = row?.photos_id ?? null;

  db.prepare('UPDATE users SET photos_id = NULL, photos_asset_id = NULL WHERE id_user = ?').run(
    userId
  );
  db.prepare('DELETE FROM photo_access_permissions WHERE owner_id = ? OR authorized_id = ?').run(
    userId,
    userId
  );

  if (!personId) {
    log.info('face data erased locally, no Immich person was linked', { reason });
    return null;
  }

  deletePersonFaceCrops(personId);
  const info = db
    .prepare('INSERT INTO face_erasures (person_id, reason, requested_at) VALUES (?, ?, ?)')
    .run(personId, reason, now);
  log.info('face data erased locally, Immich erasure journaled', {
    erasure: info.lastInsertRowid,
    reason,
  });
  return Number(info.lastInsertRowid);
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
  let person = 0;
  if (personId) {
    person = db
      .prepare("UPDATE logs SET target_id = ? WHERE target_type = 'person' AND target_id = ?")
      .run(DELETED_ID, personId).changes;
  }
  log.info('audit log anonymised for a deleted account', {
    asActor: actor.changes,
    asTarget: target.changes,
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
    anonymiseUserInLogs(db, userId, row.photos_id);
    // Per-user album grants name the member and carry no foreign key, so they do not cascade.
    db.prepare("DELETE FROM album_permissions WHERE kind = 'user' AND value = ?").run(userId);
    db.prepare('DELETE FROM users WHERE id_user = ?').run(userId);
    return { erasure };
  });
  if (!result) {
    return false;
  }
  if (result.erasure !== null) {
    void runFaceErasures();
  }
  log.info('account deleted', { erasureJournaled: result.erasure !== null });
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

async function failure(res: Response, what: string): Promise<Error> {
  const text = await res.text().catch(() => '');
  return new Error(`${what}: ${res.status} ${text.slice(0, 200)}`);
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

/** Delete, for good, every face on `assetId` that points at `personId`. Returns how many went. */
async function deleteFacesOn(fetchFn: typeof fetch, assetId: string, personId: string) {
  const facesRes = await immichCall(fetchFn, 'GET', `faces?id=${encodeURIComponent(assetId)}`);
  if (!facesRes.ok) {
    throw await failure(facesRes, `faces of asset ${assetId}`);
  }
  const faces = (await facesRes.json()) as ImmichFace[];
  let deleted = 0;
  for (const face of faces.filter((f) => f.person?.id === personId)) {
    // force: delete the record (and the embedding it carries); without it Immich only hides it.
    const del = await immichCall(fetchFn, 'DELETE', `faces/${face.id}`, { force: true });
    if (del.ok) {
      deleted++;
    } else if (del.status !== 404) {
      throw await failure(del, `delete face ${face.id}`);
    }
  }
  return deleted;
}

/**
 * The Immich half for one person: delete every face record pointing at it, on every asset it
 * appears in (trashed ones included), then the person. Returns how it ended and how many faces
 * this run deleted. Throws on any Immich refusal - the caller records it and retries later.
 */
export async function eraseImmichPerson(
  fetchFn: typeof fetch,
  personId: string
): Promise<{ outcome: 'erased' | 'absent'; facesDeleted: number }> {
  const person = await immichCall(fetchFn, 'GET', `people/${encodeURIComponent(personId)}`);
  if (person.status === 404 || person.status === 400) {
    // Immich answers 400 for "not found" AND for "no access", and a 404 may come from anything
    // between us and it. "Absent" is therefore never believed on the status alone: it is
    // believed only when a search by that person finds nothing either.
    const left = await personAssets(fetchFn, personId);
    if (left.length > 0) {
      throw new Error(
        `person lookup answered ${person.status} but ${left.length} asset(s) still show it`
      );
    }
    return { outcome: 'absent', facesDeleted: 0 };
  }
  if (!person.ok) {
    throw await failure(person, 'person lookup');
  }

  let facesDeleted = 0;
  for (const asset of await personAssets(fetchFn, personId)) {
    facesDeleted += await deleteFacesOn(fetchFn, asset.id, personId);
  }

  // Before the person goes, prove its faces did: deleting a person DETACHES whatever faces still
  // point at it rather than deleting them, so a person deleted early would strand embeddings.
  const remaining = await personAssets(fetchFn, personId);
  if (remaining.length > 0) {
    throw new Error(`${remaining.length} asset(s) still show the person after its faces went`);
  }

  const del = await immichCall(fetchFn, 'DELETE', `people/${encodeURIComponent(personId)}`, {});
  if (!del.ok && del.status !== 404) {
    throw await failure(del, 'delete person');
  }
  return { outcome: 'erased', facesDeleted };
}

let running: Promise<void> | null = null;
let rerun = false;

/**
 * Drive every pending erasure. A call made while a run is in progress does not start a second
 * one in parallel; it asks for ONE more pass after it, because the run in progress read the
 * journal before the caller's row existed. Never throws: each row's failure is logged and
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
      await runOnce(fetchFn);
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
      const relinked =
        personId && db.prepare('SELECT 1 FROM users WHERE photos_id = ?').get(personId);
      const result = !personId
        ? { outcome: 'absent' as const, facesDeleted: 0 }
        : relinked
          ? { outcome: 'relinked' as const, facesDeleted: 0 }
          : await eraseImmichPerson(fetchFn, personId);

      db.prepare(
        `UPDATE face_erasures SET done_at = ?, outcome = ?, person_id = NULL, last_error = NULL,
           attempts = attempts + 1, last_attempt_at = ?, faces_deleted = faces_deleted + ?
         WHERE id = ?`
      ).run(now, result.outcome, now, result.facesDeleted, row.id);
      if (result.outcome === 'relinked') {
        // The link path refuses a person with a pending erasure, so this is a row older than that
        // rule, or a duplicate link: never erase a person a member holds.
        log.warn('face erasure skipped: the person is linked to a member', { erasure: row.id });
      } else {
        if (personId) {
          // Crops may have been regenerated while the person still existed in Immich.
          deletePersonFaceCrops(personId);
        }
        log.info('face erasure done', {
          erasure: row.id,
          outcome: result.outcome,
          facesDeleted: result.facesDeleted,
        });
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      db.prepare(
        'UPDATE face_erasures SET attempts = attempts + 1, last_attempt_at = ?, last_error = ? WHERE id = ?'
      ).run(now, message.slice(0, 500), row.id);
      log.error('face erasure attempt failed, will retry', {
        erasure: row.id,
        attempt: row.attempts + 1,
        error: message,
      });
    }
  }

  reportOverdue(db, Date.now());
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
    void runFaceErasures().catch((e: unknown) => log.error('face erasure run crashed', e));
  };
  setTimeout(tick, 30_000);
  setInterval(tick, RETRY_INTERVAL_MS);
  log.info('face erasure worker started');
}

/**
 * Whether Immich person `personId` has an erasure still owed. The link path refuses such a
 * person: linking it would make the erasure stand down ("relinked") and leave the withdrawn
 * member's faces attached to another account.
 */
export function hasPendingErasure(db: Db, personId: string): boolean {
  return !!db
    .prepare('SELECT 1 FROM face_erasures WHERE person_id = ? AND done_at IS NULL')
    .get(personId);
}
