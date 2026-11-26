/**
 * The admin activity feed: the `logs` table read as sentences a person can scan.
 *
 * A raw row is one HTTP side effect - an upload of 300 photos is 300 `import` rows and 300
 * `add_assets` rows. This module folds those rows into ENTRIES ("X imported 300 photos into
 * album Y"), and gives every other row a typed shape the page can phrase. It is PURE - rows in,
 * entries out, no database and no clock - so `tests/audit-feed.test.ts` pins it, and the page and
 * the server share its types.
 *
 * Grouping is a presentation decision and never changes what is stored: only CONSECUTIVE rows of
 * the same actor and the same kind of batch fold together, and a pause longer than
 * {@link BATCH_GAP_SECONDS} between two of them starts a new entry, so two separate upload
 * sessions of the same afternoon stay two lines.
 */

/** One row of `logs`, as the page's load reads it. */
export interface AuditRow {
  id: number;
  /** SQLite `datetime('now')`: UTC, `YYYY-MM-DD HH:MM:SS`. */
  timestamp: string;
  actor: string | null;
  event_type: string | null;
  target_type: string | null;
  target_id: string | null;
  details: string | null;
  ip: string | null;
}

/** A field's value before and after a write. */
export type FieldChange = [unknown, unknown];

export interface AccessGrant {
  kind: string;
  value: string;
}

/** What every entry carries, whatever its kind. */
interface EntryBase {
  /** The id of the newest row folded in: unique, so the page keys on it. */
  id: number;
  /** The id of the oldest row folded in: where the next, older page starts. */
  oldestId: number;
  actor: string | null;
  /** The addresses the rows came from, distinct, newest first. */
  ips: string[];
  /** ISO instants (UTC) of the oldest and newest row. */
  start: string;
  end: string;
  /** How many rows the entry folds. */
  rows: number;
}

export type AuditEntry = EntryBase &
  (
    | {
        kind: 'upload';
        /** The album the photos went to, when an `add_assets` row said so. */
        albumId: string | null;
        /** New files (an `import` row that was not a duplicate). */
        imported: number;
        /** Files Immich already had. */
        duplicates: number;
        /** Assets put into the album. */
        added: number;
        /** The first file names, for the details panel. */
        names: string[];
        /** The first asset ids, for thumbnails. */
        assetIds: string[];
      }
    | { kind: 'assets_deleted'; count: number; assetIds: string[] }
    | { kind: 'assets_removed'; albumId: string | null; count: number; assetIds: string[] }
    | {
        kind: 'album_created';
        albumId: string | null;
        name: string | null;
        visibility: string | null;
      }
    | {
        kind: 'album_updated';
        albumId: string | null;
        /** `[from, to]` per field - rows written since the feed exists. */
        changes: Record<string, FieldChange> | null;
        access: { added: AccessGrant[]; removed: AccessGrant[] } | null;
        /** An older row's state-only details, shown as they are. */
        snapshot: Record<string, unknown> | null;
      }
    | { kind: 'album_cover'; albumId: string | null; from: string | null; to: string | null }
    | {
        kind: 'album_deleted';
        albumId: string | null;
        name: string | null;
        assetsDeleted: number | null;
      }
    | {
        kind: 'user_created' | 'user_updated' | 'user_deleted';
        userId: string | null;
        changes: Record<string, FieldChange> | null;
        faceLinkChanged: boolean;
        snapshot: Record<string, unknown> | null;
      }
    | { kind: 'api_usage'; keyPrefix: string | null; method: string | null; path: string | null }
    | {
        kind: 'other';
        eventType: string | null;
        targetType: string | null;
        targetId: string | null;
        details: unknown;
      }
  );

export type AuditEntryKind = AuditEntry['kind'];

/** Two rows further apart than this are two sessions, not one batch. */
export const BATCH_GAP_SECONDS = 10 * 60;
/** How many file names and asset ids an entry keeps for its details panel. */
export const ENTRY_SAMPLE_SIZE = 24;

/** The UTC instant of a `logs.timestamp`, as an ISO string. */
export function rowInstant(timestamp: string): string {
  return timestamp.includes('T') ? timestamp : `${timestamp.replace(' ', 'T')}Z`;
}

function parseDetails(details: string | null): Record<string, unknown> | null {
  if (!details) return null;
  try {
    const value: unknown = JSON.parse(details);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : { value };
  } catch {
    return { value: details };
  }
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
const changesOf = (v: unknown): Record<string, FieldChange> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, FieldChange>) : null;

/** The batch a row may join, or null for a row that always stands alone. */
type BatchKind = 'upload' | 'assets_deleted' | 'assets_removed';

interface Classified {
  batch: BatchKind | null;
  /** The album a batched row is about, when it names one. */
  albumId: string | null;
  details: Record<string, unknown> | null;
}

function classify(row: AuditRow): Classified {
  const details = parseDetails(row.details);
  const action = str(details?.action);
  if (row.event_type === 'import' && row.target_type === 'asset') {
    return { batch: 'upload', albumId: null, details };
  }
  if (
    row.event_type === 'update' &&
    row.target_type === 'asset' &&
    action === 'restore_duplicate_from_trash'
  ) {
    return { batch: 'upload', albumId: null, details };
  }
  if (row.event_type === 'update' && row.target_type === 'album' && action === 'add_assets') {
    return { batch: 'upload', albumId: row.target_id, details };
  }
  if (row.event_type === 'update' && row.target_type === 'album' && action === 'remove_assets') {
    return { batch: 'assets_removed', albumId: row.target_id, details };
  }
  if (row.event_type === 'delete' && row.target_type === 'asset') {
    return { batch: 'assets_deleted', albumId: null, details };
  }
  return { batch: null, albumId: null, details };
}

/** Seconds between two `logs.timestamp` values. */
function gapSeconds(a: string, b: string): number {
  return Math.abs(Date.parse(rowInstant(a)) - Date.parse(rowInstant(b))) / 1000;
}

function base(row: AuditRow): EntryBase {
  const at = rowInstant(row.timestamp);
  return {
    id: row.id,
    oldestId: row.id,
    actor: row.actor,
    ips: row.ip ? [row.ip] : [],
    start: at,
    end: at,
    rows: 1,
  };
}

function pushSample(list: string[], value: string | null): void {
  if (value && list.length < ENTRY_SAMPLE_SIZE && !list.includes(value)) list.push(value);
}

/** The entry a single, never-batched row reads as. */
function singleEntry(row: AuditRow, details: Record<string, unknown> | null): AuditEntry {
  const b = base(row);
  const action = str(details?.action);
  if (row.target_type === 'album') {
    if (row.event_type === 'create') {
      return {
        ...b,
        kind: 'album_created',
        albumId: row.target_id,
        name: str(details?.name),
        visibility: str(details?.visibility),
      };
    }
    if (row.event_type === 'delete') {
      return {
        ...b,
        kind: 'album_deleted',
        albumId: row.target_id,
        name: str(details?.name),
        assetsDeleted: num(details?.immichAssetsDeleted),
      };
    }
    if (row.event_type === 'update' && action === 'set_cover') {
      return {
        ...b,
        kind: 'album_cover',
        albumId: row.target_id,
        from: str(details?.from),
        to: str(details?.to),
      };
    }
    if (row.event_type === 'update') {
      const changes = changesOf(details?.changes);
      const access = details?.access as { added?: unknown; removed?: unknown } | undefined;
      return {
        ...b,
        kind: 'album_updated',
        albumId: row.target_id,
        changes,
        access: access
          ? {
              added: Array.isArray(access.added) ? (access.added as AccessGrant[]) : [],
              removed: Array.isArray(access.removed) ? (access.removed as AccessGrant[]) : [],
            }
          : null,
        snapshot: changes ? null : details,
      };
    }
  }
  if (
    row.target_type === 'user' &&
    (row.event_type === 'create' || row.event_type === 'update' || row.event_type === 'delete')
  ) {
    const changes = changesOf(details?.changes);
    return {
      ...b,
      kind: `user_${row.event_type === 'create' ? 'created' : row.event_type === 'update' ? 'updated' : 'deleted'}`,
      userId: row.target_id,
      changes,
      faceLinkChanged: details?.faceLinkChanged === true,
      snapshot: changes ? null : details,
    };
  }
  if (row.event_type === 'api_usage') {
    return {
      ...b,
      kind: 'api_usage',
      keyPrefix: row.target_id,
      method: str(details?.method),
      path: str(details?.path),
    };
  }
  return {
    ...b,
    kind: 'other',
    eventType: row.event_type,
    targetType: row.target_type,
    targetId: row.target_id,
    details,
  };
}

/** A fresh batched entry from its first (newest) row. */
function startBatch(row: AuditRow, c: Classified): AuditEntry {
  const b = base(row);
  if (c.batch === 'upload') {
    const entry: AuditEntry = {
      ...b,
      kind: 'upload',
      albumId: null,
      imported: 0,
      duplicates: 0,
      added: 0,
      names: [],
      assetIds: [],
    };
    foldUpload(entry, row, c);
    return entry;
  }
  if (c.batch === 'assets_removed') {
    const entry: AuditEntry = {
      ...b,
      kind: 'assets_removed',
      albumId: c.albumId,
      count: 0,
      assetIds: [],
    };
    foldIds(entry, c);
    return entry;
  }
  const entry: AuditEntry = { ...b, kind: 'assets_deleted', count: 0, assetIds: [] };
  foldIds(entry, c, row.target_id);
  return entry;
}

function foldUpload(
  entry: Extract<AuditEntry, { kind: 'upload' }>,
  row: AuditRow,
  c: Classified
): void {
  const d = c.details;
  if (row.event_type === 'import') {
    if (d?.duplicate === true) entry.duplicates++;
    else entry.imported++;
    const name = str(d?.originalName);
    // `simple-upload` was the placeholder small uploads were recorded under, not a file name.
    pushSample(entry.names, name === 'simple-upload' ? null : name);
    pushSample(entry.assetIds, row.target_id);
  } else if (c.albumId) {
    entry.albumId = c.albumId;
    entry.added += num(d?.count) ?? 0;
    for (const id of strings(d?.assetIds)) pushSample(entry.assetIds, id);
  }
}

function foldIds(
  entry: Extract<AuditEntry, { kind: 'assets_deleted' | 'assets_removed' }>,
  c: Classified,
  singleId: string | null = null
): void {
  const ids = strings(c.details?.ids ?? c.details?.assetIds);
  const count = num(c.details?.count) ?? (ids.length || (singleId && singleId !== 'bulk' ? 1 : 0));
  entry.count += count;
  for (const id of ids) pushSample(entry.assetIds, id);
  if (ids.length === 0 && singleId && singleId !== 'bulk') pushSample(entry.assetIds, singleId);
}

/** Whether `row` may join the open `entry`: same actor, same batch, same album, no long pause. */
function joins(entry: AuditEntry, row: AuditRow, c: Classified, oldest: string): boolean {
  if (!c.batch || entry.kind !== c.batch || entry.actor !== row.actor) return false;
  if (gapSeconds(oldest, row.timestamp) > BATCH_GAP_SECONDS) return false;
  if (entry.kind === 'upload' || entry.kind === 'assets_removed') {
    // An upload's `import` rows name no album; its `add_assets` rows do. Two different albums
    // are two entries.
    return !c.albumId || !entry.albumId || c.albumId === entry.albumId;
  }
  return true;
}

/**
 * Fold rows, NEWEST FIRST (the order the page reads them), into entries, newest first.
 */
export function buildAuditFeed(rows: AuditRow[]): AuditEntry[] {
  const entries: AuditEntry[] = [];
  let open: AuditEntry | null = null;
  let oldestTimestamp = '';

  for (const row of rows) {
    const c = classify(row);
    if (open && joins(open, row, c, oldestTimestamp)) {
      open.rows++;
      open.oldestId = row.id;
      open.start = rowInstant(row.timestamp);
      if (row.ip && !open.ips.includes(row.ip)) open.ips.push(row.ip);
      if (open.kind === 'upload') foldUpload(open, row, c);
      else if (open.kind === 'assets_removed') foldIds(open, c);
      else if (open.kind === 'assets_deleted') foldIds(open, c, row.target_id);
      oldestTimestamp = row.timestamp;
      continue;
    }
    const entry = c.batch ? startBatch(row, c) : singleEntry(row, c.details);
    entries.push(entry);
    open = c.batch ? entry : null;
    oldestTimestamp = row.timestamp;
  }
  return entries;
}

/** Every user id an entry names - its actor, the member it edits, the members an album grants. */
export function entryUserIds(entry: AuditEntry): string[] {
  const ids: string[] = [];
  if (entry.actor) ids.push(entry.actor);
  if ('userId' in entry && entry.userId) ids.push(entry.userId);
  if (entry.kind === 'album_updated' && entry.access) {
    for (const g of [...entry.access.added, ...entry.access.removed]) {
      if (g.kind === 'user') ids.push(g.value);
    }
  }
  return ids;
}

/** The album an entry is about, if any. */
export function entryAlbumId(entry: AuditEntry): string | null {
  return 'albumId' in entry ? entry.albumId : null;
}

/** The filter groups the page offers, each one a set of rows. */
export const AUDIT_CATEGORIES = [
  'uploads',
  'deletions',
  'albums',
  'covers',
  'users',
  'api',
] as const;
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

export function isAuditCategory(value: string): value is AuditCategory {
  return (AUDIT_CATEGORIES as readonly string[]).includes(value);
}
