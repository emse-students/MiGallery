/**
 * Revoking a user's signed avatar links (see avatar-signature.ts): give the user a fresh random
 * salt, so every URL ever issued for them stops verifying and nobody else's does.
 */

import type { getDatabase } from '$lib/db/database';
import { newAvatarSalt } from '$lib/server/avatar-signature';
import { createLogger } from '$lib/server/logger';

const log = createLogger('avatar-revocation');

/**
 * Give `userId` a fresh avatar salt, WITHOUT requiring the user row: account deletion calls it
 * inside its own transaction so a recreated account of the same id cannot re-validate old URLs.
 * The pseudonymous id stays in `avatar_revocations` as a tombstone - an id and a random salt,
 * no personal data - while the audit log scrub removes it everywhere else.
 */
export function rotateAvatarSalt(db: ReturnType<typeof getDatabase>, userId: string): void {
  db.prepare(
    `INSERT INTO avatar_revocations (id_user, salt, revoked_at) VALUES (?, ?, ?)
     ON CONFLICT(id_user) DO UPDATE SET salt = excluded.salt, revoked_at = excluded.revoked_at`
  ).run(userId, newAvatarSalt(), Date.now());
  log.info('avatar salt rotated');
}

/** Replace `userId`'s avatar salt. Returns false when there is no such user. */
export function revokeAvatarLinks(db: ReturnType<typeof getDatabase>, userId: string): boolean {
  const exists = db.prepare('SELECT 1 FROM users WHERE id_user = ?').get(userId);
  if (!exists) {
    return false;
  }
  rotateAvatarSalt(db, userId);
  return true;
}

/** The salt that signs `userId`'s links, or null when none was ever revoked. */
export function avatarSaltOf(db: ReturnType<typeof getDatabase>, userId: string): string | null {
  const row = db.prepare('SELECT salt FROM avatar_revocations WHERE id_user = ?').get(userId) as {
    salt: string;
  } | null;
  return row?.salt ?? null;
}
