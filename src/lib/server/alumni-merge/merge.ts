/**
 * THE ALUMNI MERGE, MIGALLERY'S HALF (Canari's docs/wiki/profiles-and-access.md, D52-D54; the
 * owner's decisions of 2026-11-26, items 1 and 9). A person who signed in once through the Alumni
 * base got a SECOND MiConnect account, hence a second MiGallery account; when Canari merges the
 * two, it asks each site to move what the duplicate owns onto the real account and erase the rest.
 *
 * ONE TRANSACTION: no duplicate row -> `absent`; else the target's row is created if missing (name,
 * promo, formation copied; its next sign-in overwrites them as every sign-in does), then
 * favourites, photo-access grants on both sides (a grant to oneself dropped), per-user album
 * grants, `locale` when the target has none, and - when the target holds NO face data - the face
 * link with EVERY face row AND its consent rows, unchanged (date, terms version, `source`): the
 * same person's enrolment and the same person's consent move together. When the target holds face
 * data of its own, it keeps it and the duplicate's is erased (and journalled for Immich, as any
 * deletion). Then {@link deleteUserAccountRows} erases the duplicate; {@link finishLocalErasure}
 * runs after the commit. `role` is NEVER carried (a privilege belongs to the account it was granted
 * to); a duplicate holding `admin` is REFUSED before anything is written, so the last-admin guard
 * is never what decides.
 *
 * BIOMETRIC DATA. A sealed template is bound to its member (`referenceContext`, `negativeContext`):
 * a blob moved to another member must be opened with the duplicate's context and re-sealed with
 * the target's, in this transaction; the plaintext lives in memory for one row and is zeroed. No
 * template, distance, face key, name or full subject is ever logged - counts and an 8-character
 * subject prefix only. `secure_delete` is on (database.ts), so a deleted row is overwritten.
 *
 * IDEMPOTENT FROM STATE: the duplicate's row is what is owed; once it is gone every call - a
 * retry whose answer was lost, a replayed token, a duplicate that never signed in here - is
 * `absent`, and nothing moves twice.
 */
import type { getDatabase } from '#lib/db/database.ts';
import { inTransaction } from '#lib/db/transaction.ts';
import { createLogger } from '#lib/server/logger.ts';
import {
  deleteUserAccountRows,
  finishLocalErasure,
  type LocalErasure,
} from '#lib/server/face-erasure.ts';
import { faceStoreKey } from '#lib/server/face-store.ts';
import { negativeContext, referenceContext, seal, unseal } from '#lib/server/face-seal.ts';
import type { AlumniMergeClaims } from '#lib/server/handoff/alumni-merge-verify.ts';

const log = createLogger('alumni-merge');

type Db = ReturnType<typeof getDatabase>;

/** What MiGallery answers it did. `erased` is the erase-only mode's. */
export type AlumniMergeOutcome = 'absent' | 'transferred' | 'erased';

/** A refusal typed on this site's own state: no retry changes it (Canari blocks the job). */
export type AlumniMergeRefusalCode =
  | 'ALUMNI_MERGE_SAME_SUBJECT'
  | 'ALUMNI_MERGE_DUPLICATE_IS_ADMIN'
  | 'ALUMNI_MERGE_FACE_UNREADABLE';

/** The state refused the merge; nothing was written. Answered 409 with its `code`. */
export class AlumniMergeRefusal extends Error {
  constructor(readonly code: AlumniMergeRefusalCode) {
    super(code);
    this.name = 'AlumniMergeRefusal';
  }
}

/**
 * The duplicate holds sealed face templates and this deployment cannot open them (no or a
 * malformed `FACE_STORE_KEY`): a deployment fault, not the data's - answered 503 and retried, so
 * the merge runs once the key is back. Nothing was written.
 */
export class FaceKeyUnavailableError extends Error {
  readonly code = 'FACE_STORE_KEY_UNAVAILABLE';
  constructor() {
    super('face store key unavailable');
    this.name = 'FaceKeyUnavailableError';
  }
}

/**
 * EVERY table that names a user, and what the merge does with it - the allowlist. A test walks the
 * schema and fails on a table naming a user that is not here (Canari's D53).
 */
export const ALUMNI_MERGE_TABLES = {
  users: 'target created if missing; locale and the face link moved; duplicate row deleted',
  user_favorites: 'moved (INSERT OR IGNORE), duplicate rows cascade',
  photo_access_permissions: 'moved on both sides, self-grant dropped, duplicate rows cascade',
  album_permissions: "kind 'user' moved (INSERT OR IGNORE), duplicate rows deleted",
  sessions: 'deleted (cascade); an impersonation of the duplicate is cleared (SET NULL)',
  logs: 'anonymised (deleteUserAccountRows)',
  avatar_revocations: "the duplicate's salt rotated, a tombstone without personal data",
  handoff_redemptions: "the duplicate's rows deleted",
  face_consents: 'moved with the face link, else cascade',
  face_references: 're-sealed and moved with the face link, else erased',
  face_negatives: 're-sealed and moved with the face link, else erased',
  face_reference_ledger: 're-sealed and moved with the face link, else erased',
  face_reference_selection: 'moved with the face link, else erased',
  face_match_ledger: 'moved with the face link, else erased',
  face_avatar_ledger: 'moved with the face link, else erased',
  face_rematch_pending: 'moved with the face link, else erased',
  face_matches: 'moved with the face link, else erased',
} as const;

/** What a merge call asks: the vendored verifier's claims (a transfer names its target, an erase never does). */
export type AlumniMergeRequest = AlumniMergeClaims;

/** A transfer call. */
type TransferRequest = Extract<AlumniMergeRequest, { mode: 'transfer' }>;

interface UserSnapshot {
  name: string;
  first_name: string | null;
  last_name: string | null;
  role: string | null;
  promo: number | null;
  formation: string | null;
  locale: string | null;
  photos_id: string | null;
  photos_asset_id: string | null;
  photos_asset_source: string | null;
}

/** A subject as a log line may carry it. */
export function subjectPrefix(subject: string): string {
  return subject.slice(0, 8);
}

/** Whether `userId` holds any face data: a link, a template, an answer or an open consent. */
function holdsFaceData(db: Db, userId: string, row: UserSnapshot | null): boolean {
  if (row?.photos_id) {
    return true;
  }
  const hit = db
    .prepare(
      `SELECT 1 FROM face_references WHERE user_id = ?1
       UNION ALL SELECT 1 FROM face_negatives WHERE user_id = ?1
       UNION ALL SELECT 1 FROM face_matches WHERE user_id = ?1
       UNION ALL SELECT 1 FROM face_reference_ledger WHERE user_id = ?1
       UNION ALL SELECT 1 FROM face_consents WHERE user_id = ?1 AND withdrawn_at IS NULL
       LIMIT 1`
    )
    .get(userId);
  return !!hit;
}

/** Sealed rows of `table` for `userId`, re-sealed for `target` and re-pointed. Returns the count. */
function resealRows(
  db: Db,
  key: Buffer,
  table: 'face_references' | 'face_negatives' | 'face_reference_ledger',
  dup: string,
  target: string
): number {
  const context = table === 'face_negatives' ? negativeContext : referenceContext;
  const rows = db
    .prepare(`SELECT id, model, sealed FROM ${table} WHERE user_id = ?`)
    .all(dup) as Array<{
    id: number;
    model: string;
    sealed: Uint8Array;
  }>;
  const update = db.prepare(`UPDATE ${table} SET user_id = ?, sealed = ? WHERE id = ?`);
  for (const row of rows) {
    let plain: Uint8Array;
    try {
      plain = unseal(key, context(dup, row.model), row.sealed);
    } catch {
      // face-seal logged the table; a blob that does not open now never will: a human looks.
      log.error('a sealed face row of the duplicate does not open; nothing is merged', { table });
      throw new AlumniMergeRefusal('ALUMNI_MERGE_FACE_UNREADABLE');
    }
    try {
      update.run(target, seal(key, context(target, row.model), plain), row.id);
    } finally {
      plain.fill(0);
    }
  }
  return rows.length;
}

/** The face link and every face row of `dup`, onto `target` (which holds none). Counts only. */
function moveFaceData(
  db: Db,
  dup: string,
  target: string,
  dupRow: UserSnapshot
): Record<string, number> {
  const sealedRows = (
    db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM face_references WHERE user_id = ?1)
              + (SELECT COUNT(*) FROM face_negatives WHERE user_id = ?1)
              + (SELECT COUNT(*) FROM face_reference_ledger WHERE user_id = ?1) AS n`
      )
      .get(dup) as { n: number }
  ).n;
  let key: Buffer | null = null;
  if (sealedRows > 0) {
    try {
      key = faceStoreKey();
    } catch {
      log.error('the duplicate holds sealed face rows and FACE_STORE_KEY is unusable; retried');
      throw new FaceKeyUnavailableError();
    }
  }
  const counts: Record<string, number> = {};
  if (key) {
    counts.face_references = resealRows(db, key, 'face_references', dup, target);
    counts.face_negatives = resealRows(db, key, 'face_negatives', dup, target);
    counts.face_reference_ledger = resealRows(db, key, 'face_reference_ledger', dup, target);
  }
  for (const table of [
    'face_consents',
    'face_matches',
    'face_reference_selection',
    'face_match_ledger',
    'face_avatar_ledger',
    'face_rematch_pending',
  ] as const) {
    counts[table] = db
      .prepare(`UPDATE ${table} SET user_id = ? WHERE user_id = ?`)
      .run(target, dup).changes;
  }
  // The duplicate lets go first (`photos_id` is unique), so its deletion journals nothing for Immich.
  db.prepare(
    'UPDATE users SET photos_id = NULL, photos_asset_id = NULL, photos_asset_source = NULL WHERE id_user = ?'
  ).run(dup);
  db.prepare(
    'UPDATE users SET photos_id = ?, photos_asset_id = ?, photos_asset_source = ? WHERE id_user = ?'
  ).run(dupRow.photos_id, dupRow.photos_asset_id, dupRow.photos_asset_source, target);
  return counts;
}

function readUser(db: Db, userId: string): UserSnapshot | null {
  return (
    (db
      .prepare(
        `SELECT name, first_name, last_name, role, promo, formation, locale, photos_id,
                photos_asset_id, photos_asset_source
           FROM users WHERE id_user = ?`
      )
      .get(userId) as UserSnapshot | null) ?? null
  );
}

/** The transfer's writes, inside the transaction. Returns what to finish after the commit. */
function transfer(
  db: Db,
  req: TransferRequest,
  dupRow: UserSnapshot,
  tag: string
): LocalErasure | null {
  const { dup, target } = req;
  let targetRow = readUser(db, target);
  const created = !targetRow;
  if (!targetRow) {
    db.prepare(
      `INSERT INTO users (id_user, name, first_name, last_name, role, promo, formation)
       VALUES (?, ?, ?, ?, 'user', ?, ?)`
    ).run(target, dupRow.name, dupRow.first_name, dupRow.last_name, dupRow.promo, dupRow.formation);
    targetRow = readUser(db, target);
  }
  if (dupRow.role && dupRow.role !== 'user') {
    log.warn(`${tag} the duplicate's role is not carried (a privilege stays with its account)`, {
      role: dupRow.role,
    });
  }
  const favourites = db
    .prepare(
      `INSERT OR IGNORE INTO user_favorites (user_id, asset_id, created_at)
       SELECT ?, asset_id, created_at FROM user_favorites WHERE user_id = ?`
    )
    .run(target, dup).changes;
  const grantsGiven = db
    .prepare(
      `INSERT OR IGNORE INTO photo_access_permissions (owner_id, authorized_id, created_at)
       SELECT ?1, authorized_id, created_at FROM photo_access_permissions
        WHERE owner_id = ?2 AND authorized_id != ?1`
    )
    .run(target, dup).changes;
  const grantsReceived = db
    .prepare(
      `INSERT OR IGNORE INTO photo_access_permissions (owner_id, authorized_id, created_at)
       SELECT owner_id, ?1, created_at FROM photo_access_permissions
        WHERE authorized_id = ?2 AND owner_id != ?1`
    )
    .run(target, dup).changes;
  const albumGrants = db
    .prepare(
      `INSERT OR IGNORE INTO album_permissions (album_id, kind, value)
       SELECT album_id, 'user', ? FROM album_permissions WHERE kind = 'user' AND value = ?`
    )
    .run(target, dup).changes;
  const locale =
    !targetRow?.locale && dupRow.locale
      ? db.prepare('UPDATE users SET locale = ? WHERE id_user = ?').run(dupRow.locale, target)
          .changes
      : 0;
  const dupHasFace = holdsFaceData(db, dup, dupRow);
  let face: Record<string, number> | 'none' | 'target_kept' = 'none';
  if (dupHasFace) {
    face = holdsFaceData(db, target, targetRow)
      ? 'target_kept'
      : moveFaceData(db, dup, target, dupRow);
  }
  db.prepare('DELETE FROM handoff_redemptions WHERE sub = ?').run(dup);
  const erasure = deleteUserAccountRows(db, dup);
  log.info(`${tag} transferred`, {
    targetCreated: created,
    favourites,
    grantsGiven,
    grantsReceived,
    albumGrants,
    locale,
    face,
  });
  return erasure;
}

/**
 * Run one merge call against `db`. Throws {@link AlumniMergeRefusal} (409) or
 * {@link FaceKeyUnavailableError} (503), writing nothing; a database fault throws as it is.
 */
export function mergeAlumniDuplicate(db: Db, req: AlumniMergeRequest): AlumniMergeOutcome {
  const tag = `[ALUMNI_MERGE] jti=${req.jti} dup=${subjectPrefix(req.dup)} target=${req.mode === 'transfer' ? subjectPrefix(req.target) : 'none'} mode=${req.mode}`;
  log.info(`${tag} received`);
  if (req.mode === 'transfer' && req.dup === req.target) {
    log.error(`${tag} refused: the duplicate and the target are one subject`);
    throw new AlumniMergeRefusal('ALUMNI_MERGE_SAME_SUBJECT');
  }
  const result = inTransaction(
    db,
    (): { outcome: AlumniMergeOutcome; erasure: LocalErasure | null } => {
      const dupRow = readUser(db, req.dup);
      if (!dupRow) {
        return { outcome: 'absent', erasure: null };
      }
      if (dupRow.role === 'admin') {
        // A duplicate is an Alumni sign-in, never an administrator: something else is wrong.
        log.error(`${tag} refused: the duplicate is an administrator here; a human must look`);
        throw new AlumniMergeRefusal('ALUMNI_MERGE_DUPLICATE_IS_ADMIN');
      }
      if (req.mode === 'erase') {
        db.prepare('DELETE FROM handoff_redemptions WHERE sub = ?').run(req.dup);
        return { outcome: 'erased', erasure: deleteUserAccountRows(db, req.dup) };
      }
      return { outcome: 'transferred', erasure: transfer(db, req, dupRow, tag) };
    }
  );
  if (result.erasure) {
    finishLocalErasure(result.erasure);
  }
  log.info(`${tag} done outcome=${result.outcome}`);
  return result.outcome;
}
