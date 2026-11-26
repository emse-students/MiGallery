import type { PageServerLoad } from './$types';
import { requireAdminPage } from '#lib/server/auth.ts';
import { getDatabase } from '#lib/db/database.ts';
import {
  buildAuditFeed,
  entryAlbumId,
  entryUserIds,
  isAuditCategory,
  type AuditCategory,
  type AuditRow,
} from '#lib/audit-feed.ts';

/**
 * How many raw rows one page reads. Generous because a single upload is two rows per photo: a
 * window this size still shows a 900-photo upload as ONE entry.
 */
const ROW_LIMIT = 2000;

/** A row's `details.action`, guarded: `json_extract` throws on a value that is not JSON. */
const ACTION_SQL = "(CASE WHEN json_valid(details) THEN json_extract(details, '$.action') END)";

/** The rows each filter category keeps. */
const CATEGORY_SQL: Record<AuditCategory, string> = {
  uploads: `(event_type = 'import' OR (event_type = 'update' AND target_type = 'asset') OR (event_type = 'update' AND target_type = 'album' AND ${ACTION_SQL} = 'add_assets'))`,
  deletions: `(event_type = 'delete' OR ${ACTION_SQL} = 'remove_assets')`,
  albums: `(target_type = 'album' AND COALESCE(${ACTION_SQL}, '') NOT IN ('add_assets', 'remove_assets'))`,
  covers: `(${ACTION_SQL} = 'set_cover')`,
  users: `(target_type = 'user')`,
  api: `(event_type = 'api_usage')`,
};

/** How the feed names a member. */
export interface AuditPerson {
  name: string;
  role: string | null;
}

interface UserRow {
  id_user: string;
  name: string | null;
  first_name: string | null;
  last_name: string | null;
  role: string | null;
}

function personOf(u: UserRow): AuditPerson {
  const full = [u.first_name, u.last_name].filter(Boolean).join(' ').trim();
  return { name: full || u.name || u.id_user.slice(0, 8), role: u.role };
}

/** `IN (?, ?, ...)` for a list, run in slices so no statement exceeds SQLite's bound limit. */
function selectIn<T>(sql: (placeholders: string) => string, ids: string[]): T[] {
  const db = getDatabase();
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 500) {
    const slice = ids.slice(i, i + 500);
    out.push(...(db.prepare(sql(slice.map(() => '?').join(', '))).all(...slice) as T[]));
  }
  return out;
}

export const load: PageServerLoad = ({ locals, cookies, url }) => {
  requireAdminPage({ locals, cookies }, url);

  const db = getDatabase();

  const beforeParam = parseInt(url.searchParams.get('before') || '', 10);
  const before = Number.isFinite(beforeParam) && beforeParam > 0 ? beforeParam : null;
  const q = (url.searchParams.get('q') || '').trim();
  const actor = (url.searchParams.get('actor') || '').trim();
  const categoryParam = (url.searchParams.get('category') || '').trim();
  const category = isAuditCategory(categoryParam) ? categoryParam : '';

  const where: string[] = [];
  const params: unknown[] = [];
  if (category) {
    where.push(CATEGORY_SQL[category]);
  }
  if (actor) {
    where.push('actor = ?');
    params.push(actor);
  }
  if (q) {
    // A person or an album is searched by its NAME, which the row does not carry.
    where.push(
      `(details LIKE ? OR target_id LIKE ? OR ip LIKE ?
        OR actor IN (SELECT id_user FROM users WHERE name LIKE ? OR (COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')) LIKE ?)
        OR target_id IN (SELECT id FROM albums WHERE name LIKE ?))`
    );
    const like = `%${q}%`;
    params.push(like, like, like, like, like, like);
  }
  const filterSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const pageSql = [...where, ...(before ? ['id < ?'] : [])];
  const pageWhere = pageSql.length ? `WHERE ${pageSql.join(' AND ')}` : '';

  const total = (
    db.prepare(`SELECT COUNT(*) as c FROM logs ${filterSql}`).get(...params) as { c: number }
  ).c;

  const fetched = db
    .prepare(
      `SELECT id, timestamp, actor, event_type, target_type, target_id, details, ip FROM logs ${pageWhere} ORDER BY id DESC LIMIT ?`
    )
    .all(...params, ...(before ? [before] : []), ROW_LIMIT + 1) as AuditRow[];
  const hasMore = fetched.length > ROW_LIMIT;
  const entries = buildAuditFeed(hasMore ? fetched.slice(0, ROW_LIMIT) : fetched);
  // The last entry may go on past the window: it is shown whole on the next page instead.
  if (hasMore && entries.length > 1) {
    entries.pop();
  }
  const nextCursor = hasMore && entries.length > 0 ? entries[entries.length - 1].oldestId : null;

  // Names: of every member the page shows, and of every album - from the album itself, or, once
  // it is deleted, from the row that created or deleted it.
  const actorIds = (
    db.prepare('SELECT DISTINCT actor FROM logs WHERE actor IS NOT NULL').all() as {
      actor: string;
    }[]
  ).map((r) => r.actor);
  const userIds = [...new Set([...actorIds, ...entries.flatMap(entryUserIds)])];
  const people: Record<string, AuditPerson> = {};
  for (const u of selectIn<UserRow>(
    (p) => `SELECT id_user, name, first_name, last_name, role FROM users WHERE id_user IN (${p})`,
    userIds
  )) {
    people[u.id_user] = personOf(u);
  }

  const albumIds = [...new Set(entries.map(entryAlbumId).filter((id): id is string => !!id))];
  const albums: Record<string, string> = {};
  for (const a of selectIn<{ id: string; name: string }>(
    (p) => `SELECT id, name FROM albums WHERE id IN (${p})`,
    albumIds
  )) {
    albums[a.id] = a.name;
  }
  const gone = albumIds.filter((id) => !(id in albums));
  for (const r of selectIn<{ target_id: string; name: string | null }>(
    (p) =>
      `SELECT target_id, json_extract(details, '$.name') AS name FROM logs
       WHERE target_type = 'album' AND event_type IN ('create', 'delete') AND json_valid(details)
         AND json_extract(details, '$.name') IS NOT NULL AND target_id IN (${p})
       ORDER BY id`,
    gone
  )) {
    if (r.name) albums[r.target_id] = r.name;
  }

  const actors = actorIds
    .map((id) => ({ id, name: people[id]?.name ?? id.slice(0, 8) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));

  return {
    entries,
    people,
    albums,
    actors,
    total,
    nextCursor,
    isFirstPage: before === null,
    filters: { q, actor, category },
  };
};
