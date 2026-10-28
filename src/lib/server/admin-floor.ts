/**
 * The last-admin floor: MiGallery always keeps at least one account with the `admin` role.
 *
 * An account that loses `admin` - by a role change or by deletion - is checked HERE, inside the
 * same `BEGIN IMMEDIATE` transaction as the write (`inTransaction`, face-erasure.ts). The immediate
 * lock serialises every writer of the database, so two admins demoting each other at the same time
 * cannot both read "one other admin remains": the second one reads the first one's commit.
 *
 * A refusal is a TYPE ({@link LastAdminError}), mapped to a 409 by each route, never a message to
 * match.
 */

import type { getDatabase } from '#lib/db/database.ts';
import { createLogger } from '#lib/server/logger.ts';

type Db = ReturnType<typeof getDatabase>;

const log = createLogger('admin-floor');

/** The write would leave no account with the `admin` role. */
export class LastAdminError extends Error {
  constructor() {
    super('At least one administrator must remain');
    this.name = 'LastAdminError';
  }
}

/**
 * Throws {@link LastAdminError} when `userId` is an admin and no OTHER admin exists, i.e. when
 * removing its admin role (demotion or deletion) would leave none. A no-op for a non-admin or an
 * unknown account. Must be called inside the transaction that performs the write.
 */
export function assertAnotherAdminRemains(db: Db, userId: string): void {
  const row = db.prepare('SELECT role FROM users WHERE id_user = ?').get(userId) as {
    role: string;
  } | null;
  if (row?.role !== 'admin') {
    return;
  }
  const others = db
    .prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND id_user != ?")
    .get(userId) as { n: number };
  if (others.n === 0) {
    log.warn('refused: the write would remove the last administrator');
    throw new LastAdminError();
  }
}
