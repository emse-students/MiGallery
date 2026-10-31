import type { DatabaseInstance } from '#lib/db/database.ts';

/**
 * Run `fn` in one SQLite transaction (`BEGIN IMMEDIATE`: the write lock is taken at once, so a
 * read-then-write inside cannot be raced by another writer). Rolled back if `fn` throws.
 */
export function inTransaction<T>(db: DatabaseInstance, fn: () => T): T {
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
