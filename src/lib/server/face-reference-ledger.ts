/**
 * The ledger of a selection pass, and the way back (faces v2.1, docs/wiki/face-matching-option-c.md).
 *
 * WHY. The reference selection (face-reference-upgrade.ts) rewrites a member's references in the
 * background at deploy, and the re-match that follows changes which faces they are shown. Neither
 * had a record of what it replaced, so a wrong rewrite could not be taken back. Now every rewrite
 * is preceded, in the SAME transaction, by a copy of what it replaces:
 * - the member's `face_references` rows, verbatim (sealed blobs: the ciphertext is bound to the
 *   member and model, never re-encoded, so a restore opens as the original did);
 * - their PENDING matches (`auto` shown without a question, `suggested` waiting): confirmed and
 *   rejected rows are the member's own answers, which a pass never touches and an undo keeps.
 *
 * THE UNDO ({@link undoReferenceSelection}), one member, inside the engine lock, one transaction:
 * the references are replaced by the snapshot's, the pending matches by the snapshot's (a face
 * another member has since CONFIRMED cannot be given back: counted as a conflict, never forced),
 * the selection marker stays at the pass's version so the member is not redone, and the snapshot
 * is consumed. The faces the member held now and the snapshot does not name are re-decided for
 * everyone, so they go back to whoever is nearest. What an undo does NOT bring back: a reference
 * the member learned by answering AFTER the pass (it is replaced by the snapshot's set, answers
 * stay as rows), and a face another member lost to this one during the pass (it is re-decided at
 * that member's next re-match). So undo soon, not months later.
 *
 * RETENTION. The ledger holds sealed biometric vectors. It goes with the member (withdrawal,
 * unlink, account deletion: `eraseFaceReferences` and the cascade) and for everyone at once with
 * {@link purgeSelectionLedger}, which the owner runs when the window is closed. No clock.
 */

import type { DatabaseInstance } from '#lib/db/database.ts';
import { inTransaction } from '#lib/db/transaction.ts';
import { FACE_MODEL, FACE_SELECTION_UNDONE } from '#lib/face-embedding.ts';
import { redecideFaces, type FaceEngine } from '#lib/server/face-engine.ts';
import { createLogger } from '#lib/server/logger.ts';
import type { FaceKey } from '#lib/server/face-store.ts';

const log = createLogger('face-reference-ledger');

/** What a snapshot kept. */
export interface LedgerSaved {
  references: number;
  matches: number;
}

/**
 * Copy the member's references and pending matches into the ledger under `version`, replacing an
 * earlier snapshot of the same version. Inside the caller's transaction, BEFORE it changes either.
 */
export function saveSelectionLedger(
  db: DatabaseInstance,
  userId: string,
  version: number,
  now: number
): LedgerSaved {
  db.prepare(
    'DELETE FROM face_reference_ledger WHERE user_id = ? AND model = ? AND version = ?'
  ).run(userId, FACE_MODEL, version);
  db.prepare('DELETE FROM face_match_ledger WHERE user_id = ? AND model = ? AND version = ?').run(
    userId,
    FACE_MODEL,
    version
  );
  const references = db
    .prepare(
      `INSERT INTO face_reference_ledger (user_id, model, version, saved_at, source, sealed,
         created_at, asset_id, face_index, taken_at)
       SELECT user_id, model, ?, ?, source, sealed, created_at, asset_id, face_index, taken_at
         FROM face_references WHERE user_id = ? AND model = ?`
    )
    .run(version, now, userId, FACE_MODEL).changes;
  const matches = db
    .prepare(
      `INSERT INTO face_match_ledger (user_id, model, version, saved_at, asset_id, face_index,
         distance, runner_up, band, created_at)
       SELECT user_id, model, ?, ?, asset_id, face_index, distance, runner_up, band, created_at
         FROM face_matches WHERE user_id = ? AND model = ? AND state = 'pending'`
    )
    .run(version, now, userId, FACE_MODEL).changes;
  // The profile photo pointer too: the pass that follows may set a DEFAULT one other members see.
  db.prepare(
    `INSERT OR REPLACE INTO face_avatar_ledger (user_id, version, saved_at, photos_asset_id,
       photos_asset_source)
     SELECT id_user, ?, ?, photos_asset_id, photos_asset_source FROM users WHERE id_user = ?`
  ).run(version, now, userId);
  log.info('selection ledger saved', { version, references, matches });
  return { references, matches };
}

/** What an undo restored. */
export interface UndoResult {
  /** The selection version whose snapshot was restored. */
  version: number;
  references: number;
  matches: number;
  /** Snapshot faces that could not be given back (another member confirmed them since). */
  conflicts: number;
  /** Faces the member held that the snapshot does not name, re-decided for everyone. */
  redecided: number;
}

/**
 * Take the member's latest selection back to what the ledger holds. Inside the engine lock (it
 * re-decides faces). `null` when the ledger has nothing of theirs. Idempotent by consumption: a
 * second call finds nothing.
 */
export function undoReferenceSelection(
  engine: FaceEngine,
  userId: string,
  now: number = Date.now()
): UndoResult | null {
  const { db } = engine;
  const toRedecide: FaceKey[] = [];
  const result = inTransaction(db, (): UndoResult | null => {
    const latest = db
      .prepare(
        'SELECT MAX(version) AS v FROM face_reference_ledger WHERE user_id = ? AND model = ?'
      )
      .get(userId, FACE_MODEL) as { v: number | null };
    if (latest.v === null) {
      return null;
    }
    const version = latest.v;
    const refs = db
      .prepare(
        `SELECT source, sealed, created_at, asset_id, face_index, taken_at FROM face_reference_ledger
          WHERE user_id = ? AND model = ? AND version = ? ORDER BY id`
      )
      .all(userId, FACE_MODEL, version) as Array<Record<string, unknown>>;
    const matches = db
      .prepare(
        `SELECT asset_id, face_index, distance, runner_up, band, created_at FROM face_match_ledger
          WHERE user_id = ? AND model = ? AND version = ?`
      )
      .all(userId, FACE_MODEL, version) as Array<{
      asset_id: string;
      face_index: number;
      distance: number;
      runner_up: number | null;
      band: string;
      created_at: number;
    }>;
    const snapshotKeys = new Set(matches.map((m) => `${m.asset_id}\u0000${m.face_index}`));
    const heldNow = db
      .prepare(
        `SELECT asset_id, face_index FROM face_matches
          WHERE user_id = ? AND model = ? AND state = 'pending'`
      )
      .all(userId, FACE_MODEL) as Array<{ asset_id: string; face_index: number }>;
    for (const h of heldNow) {
      if (!snapshotKeys.has(`${h.asset_id}\u0000${h.face_index}`)) {
        toRedecide.push({ assetId: h.asset_id, faceIndex: h.face_index });
      }
    }

    db.prepare('DELETE FROM face_references WHERE user_id = ? AND model = ?').run(
      userId,
      FACE_MODEL
    );
    const insertRef = db.prepare(
      `INSERT INTO face_references (user_id, model, source, sealed, created_at, asset_id,
         face_index, taken_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const r of refs) {
      insertRef.run(
        userId,
        FACE_MODEL,
        r.source as string,
        r.sealed as Uint8Array,
        r.created_at as number,
        (r.asset_id as string | null) ?? null,
        (r.face_index as number | null) ?? null,
        (r.taken_at as number | null) ?? null
      );
    }

    db.prepare(
      "DELETE FROM face_matches WHERE user_id = ? AND model = ? AND state = 'pending'"
    ).run(userId, FACE_MODEL);
    const insertMatch = db.prepare(
      `INSERT OR IGNORE INTO face_matches (asset_id, face_index, model, user_id, distance,
         runner_up, band, state, created_at, decided_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, NULL)`
    );
    let restored = 0;
    for (const m of matches) {
      restored += insertMatch.run(
        m.asset_id,
        m.face_index,
        FACE_MODEL,
        userId,
        m.distance,
        m.runner_up,
        m.band,
        m.created_at
      ).changes;
    }

    // The member is marked UNDONE: the tick never selects for them again, and a new selfie clears
    // the mark (enrolMember). A pass undone with a version marker would be redone at the next bump.
    db.prepare(
      `INSERT INTO face_reference_selection (user_id, model, version, selected_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id, model) DO UPDATE SET version = excluded.version,
          selected_at = excluded.selected_at`
    ).run(userId, FACE_MODEL, FACE_SELECTION_UNDONE, now);
    // A re-match the pass left owed would undo the undo.
    db.prepare('DELETE FROM face_rematch_pending WHERE user_id = ? AND model = ?').run(
      userId,
      FACE_MODEL
    );
    // The profile photo goes back only while it is still a DEFAULT: a choice is never overwritten.
    const avatar = db
      .prepare(
        'SELECT photos_asset_id, photos_asset_source FROM face_avatar_ledger WHERE user_id = ? AND version = ?'
      )
      .get(userId, version) as {
      photos_asset_id: string | null;
      photos_asset_source: string | null;
    } | null;
    if (avatar) {
      db.prepare(
        `UPDATE users SET photos_asset_id = ?, photos_asset_source = ?
          WHERE id_user = ? AND (photos_asset_id IS NULL OR photos_asset_id = ''
            OR photos_asset_source = 'default')`
      ).run(avatar.photos_asset_id, avatar.photos_asset_source, userId);
      db.prepare('DELETE FROM face_avatar_ledger WHERE user_id = ? AND version = ?').run(
        userId,
        version
      );
    }

    db.prepare(
      'DELETE FROM face_reference_ledger WHERE user_id = ? AND model = ? AND version = ?'
    ).run(userId, FACE_MODEL, version);
    db.prepare('DELETE FROM face_match_ledger WHERE user_id = ? AND model = ? AND version = ?').run(
      userId,
      FACE_MODEL,
      version
    );
    return {
      version,
      references: refs.length,
      matches: restored,
      conflicts: matches.length - restored,
      redecided: toRedecide.length,
    };
  });
  if (result && toRedecide.length > 0) {
    // After the commit, still inside the lock: they go back to whoever is nearest now.
    redecideFaces(engine, toRedecide);
  }
  log.info('selection undone', result ? { ...result } : { found: false });
  return result;
}

/** How much the ledger holds: members, reference rows, match rows. Counts only. */
export function ledgerCounts(db: DatabaseInstance): {
  members: number;
  references: number;
  matches: number;
} {
  const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  return {
    members: count(
      `SELECT COUNT(*) AS n FROM (SELECT user_id FROM face_reference_ledger
         UNION SELECT user_id FROM face_match_ledger)`
    ),
    references: count('SELECT COUNT(*) AS n FROM face_reference_ledger'),
    matches: count('SELECT COUNT(*) AS n FROM face_match_ledger'),
  };
}

/** End the undo window for everyone: delete the whole ledger. Returns the rows that went. */
export function purgeSelectionLedger(db: DatabaseInstance): number {
  const gone =
    db.prepare('DELETE FROM face_reference_ledger').run().changes +
    db.prepare('DELETE FROM face_match_ledger').run().changes +
    db.prepare('DELETE FROM face_avatar_ledger').run().changes;
  log.info('selection ledger purged', { rows: gone });
  return gone;
}
