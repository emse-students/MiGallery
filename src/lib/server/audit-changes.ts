import type { DatabaseInstance } from '#lib/db/database.ts';

/**
 * What an audit row says changed: the value of each field BEFORE and AFTER the write, and nothing
 * for a field the write left as it was. The admin activity feed (`src/lib/audit-feed.ts`) prints
 * these as "name: A -> B"; a row that only held the new state could not say what it replaced.
 */
export type FieldChanges = Record<string, [unknown, unknown]>;

/** One line of `album_permissions`: who, besides the visibility, may open the album. */
export interface AccessGrant {
  kind: string;
  value: string;
}

/** The grants a write added and removed. */
export interface AccessChanges {
  added: AccessGrant[];
  removed: AccessGrant[];
}

/** The fields of an album an admin edits, read before and after the write. */
export interface AlbumAuditState {
  name: string | null;
  date: string | null;
  location: string | null;
  visibility: string | null;
  visible: boolean;
  access: AccessGrant[];
}

/** The `details` of an `update album` row written by a metadata edit. */
export interface AlbumChangeDetails {
  changes: FieldChanges;
  access?: AccessChanges;
}

/**
 * The fields whose value differs between `before` and `after`, as `[from, to]`. `null` and
 * `undefined` are the same absence, so a field that stays empty is not a change.
 */
export function fieldChanges<T extends object>(
  before: T,
  after: T,
  fields: ReadonlyArray<keyof T & string>
): FieldChanges {
  const changes: FieldChanges = {};
  for (const field of fields) {
    const from = before[field] ?? null;
    const to = after[field] ?? null;
    if (from !== to) {
      changes[field] = [from, to];
    }
  }
  return changes;
}

const grantKey = (g: AccessGrant) => `${g.kind}\u0000${g.value}`;

/** The grants present in `after` and not in `before`, and the reverse. */
export function accessChanges(before: AccessGrant[], after: AccessGrant[]): AccessChanges {
  const was = new Set(before.map(grantKey));
  const is = new Set(after.map(grantKey));
  return {
    added: after.filter((g) => !was.has(grantKey(g))),
    removed: before.filter((g) => !is.has(grantKey(g))),
  };
}

/** Read an album's editable state, or null when the album is unknown. */
export function readAlbumAuditState(db: DatabaseInstance, albumId: string): AlbumAuditState | null {
  const row = db
    .prepare('SELECT name, date, location, visibility, visible FROM albums WHERE id = ?')
    .get(albumId) as
    | {
        name: string | null;
        date: string | null;
        location: string | null;
        visibility: string | null;
        visible: number | null;
      }
    | undefined;
  if (!row) {
    return null;
  }
  const access = db
    .prepare('SELECT kind, value FROM album_permissions WHERE album_id = ? ORDER BY kind, value')
    .all(albumId) as AccessGrant[];
  return { ...row, visible: row.visible !== 0, access };
}

const ALBUM_FIELDS = ['name', 'date', 'location', 'visibility', 'visible'] as const;

/**
 * The details of an album edit, or null when the write changed nothing - a "save" that left
 * every field as it was is not an event, and logging it would bury the edits that were.
 */
export function albumChangeDetails(
  before: AlbumAuditState,
  after: AlbumAuditState
): AlbumChangeDetails | null {
  const changes = fieldChanges(before, after, ALBUM_FIELDS);
  const access = accessChanges(before.access, after.access);
  const accessChanged = access.added.length > 0 || access.removed.length > 0;
  if (Object.keys(changes).length === 0 && !accessChanged) {
    return null;
  }
  return accessChanged ? { changes, access } : { changes };
}
