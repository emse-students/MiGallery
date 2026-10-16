/**
 * Changing the face link of an account: the ONE place in the application that writes
 * `users.photos_id`, so the things that must move with it cannot be forgotten by one of its
 * callers. `createUser` / `updateUser` (db/users.ts) refuse the column. The only other writers are
 * dev and seed scripts that insert the system user with a NULL link (`dev/login-as`,
 * `scripts/init-db.cjs`, `scripts/inspect-db.cjs`), which have no consent to record.
 *
 * A link is what `photo_access_permissions` grants, the consent record and the Immich person's
 * name all hang from. So when the person CHANGES - a relink to someone else, an unlink by the
 * member, an unlink or a change by an admin - the old person's grants go, the consent for the old
 * person is closed, the old person is journaled for the Immich clearing
 * ({@link eraseLocalFaceData}), and a new consent is recorded for the new one. All of it inside the
 * caller's ONE transaction with the link write itself: a link that moved without its consent row,
 * or a consent row without its link, would be an unprovable state.
 */

import type { getDatabase } from '$lib/db/database';
import {
  eraseLocalFaceData,
  type FaceErasureReason,
  type LocalErasure,
} from '$lib/server/face-erasure';
import { recordFaceConsent } from '$lib/server/face-consent';

type Db = ReturnType<typeof getDatabase>;

export interface FaceLinkOptions {
  /** How the new link was authorised: the member's own selfie, or an admin who skipped that check. */
  source: 'selfie' | 'admin';
  /** What an unlink (person -> null) is called in the journal. */
  unlinkReason: Extract<FaceErasureReason, 'withdrawal' | 'admin_unlink'>;
  /**
   * The profile-photo asset to store: a string or null sets it, `undefined` leaves it alone - except
   * that a changed person always clears it, since the old one belonged to the old person.
   */
  assetId?: string | null;
}

export interface FaceLinkResult {
  changed: boolean;
  /** To pass to {@link finishLocalErasure} AFTER the caller's COMMIT; null when nothing was undone. */
  local: LocalErasure | null;
}

/** Set `userId`'s link to `personId` (null = unlink). MUST run inside the caller's transaction. */
export function applyFaceLink(
  db: Db,
  userId: string,
  personId: string | null,
  options: FaceLinkOptions
): FaceLinkResult {
  const before =
    (
      db.prepare('SELECT photos_id FROM users WHERE id_user = ?').get(userId) as {
        photos_id: string | null;
      } | null
    )?.photos_id ?? null;
  const changed = before !== personId;

  let local: LocalErasure | null = null;
  if (changed && before !== null) {
    local = eraseLocalFaceData(db, userId, personId === null ? options.unlinkReason : 'relink');
  }
  if (personId !== null && changed) {
    db.prepare('UPDATE users SET photos_id = ? WHERE id_user = ?').run(personId, userId);
    recordFaceConsent(db, userId, options.source);
  }
  if (options.assetId !== undefined && personId !== null) {
    db.prepare('UPDATE users SET photos_asset_id = ? WHERE id_user = ?').run(
      options.assetId,
      userId
    );
  }
  return { changed, local };
}
