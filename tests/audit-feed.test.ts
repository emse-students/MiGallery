/**
 * The admin activity feed folds raw audit rows into entries a person can read.
 *
 * What it pins: an upload session (one `import` and one `add_assets` row per photo) reads as ONE
 * entry naming its album and its counts; a pause, another actor or another album starts a new one;
 * a cover change keeps its before and after; an album edit keeps its `[from, to]` pairs, and an
 * older state-only row is still shown as such rather than dropped.
 */

import { describe, it, expect } from 'vitest';
import { buildAuditFeed, BATCH_GAP_SECONDS, type AuditRow } from '#lib/audit-feed.ts';
import { albumChangeDetails, fieldChanges } from '#lib/server/audit-changes.ts';

let nextId = 1;
function row(partial: Partial<AuditRow> & { timestamp: string }): AuditRow {
  return {
    id: nextId++,
    actor: 'victor',
    event_type: null,
    target_type: null,
    target_id: null,
    details: null,
    ip: '203.0.113.7',
    ...partial,
  };
}

/** An upload of one photo into `album`, at `ts`: its import row then its album row. */
function uploadOf(asset: string, album: string, ts: string, actor = 'victor'): AuditRow[] {
  return [
    row({
      timestamp: ts,
      actor,
      event_type: 'import',
      target_type: 'asset',
      target_id: asset,
      details: JSON.stringify({ originalName: `${asset}.jpg`, proxied: true, duplicate: false }),
    }),
    row({
      timestamp: ts,
      actor,
      event_type: 'update',
      target_type: 'album',
      target_id: album,
      details: JSON.stringify({ action: 'add_assets', count: 1, assetIds: [asset] }),
    }),
  ];
}

/** The page reads rows newest first. */
const newestFirst = (rows: AuditRow[]) => [...rows].sort((a, b) => b.id - a.id);

describe('buildAuditFeed', () => {
  it('folds an upload session into one entry with its album and counts', () => {
    const rows = [
      ...uploadOf('a1', 'alb', '2026-11-25 14:56:01'),
      ...uploadOf('a2', 'alb', '2026-11-25 14:56:03'),
      ...uploadOf('a3', 'alb', '2026-11-25 14:56:05'),
    ];
    const feed = buildAuditFeed(newestFirst(rows));
    expect(feed).toHaveLength(1);
    const entry = feed[0];
    expect(entry.kind).toBe('upload');
    if (entry.kind !== 'upload') return;
    expect(entry.albumId).toBe('alb');
    expect(entry.imported).toBe(3);
    expect(entry.added).toBe(3);
    expect(entry.rows).toBe(6);
    expect(entry.names).toEqual(['a3.jpg', 'a2.jpg', 'a1.jpg']);
    expect(entry.start).toBe('2026-11-25T14:56:01Z');
    expect(entry.end).toBe('2026-11-25T14:56:05Z');
    expect(entry.oldestId).toBe(rows[0].id);
    expect(entry.id).toBe(rows[rows.length - 1].id);
  });

  it('splits on a pause, another actor and another album', () => {
    const late = new Date(Date.parse('2026-11-25T15:00:00Z') + (BATCH_GAP_SECONDS + 60) * 1000)
      .toISOString()
      .replace('T', ' ')
      .slice(0, 19);
    const rows = [
      ...uploadOf('a1', 'alb', '2026-11-25 15:00:00'),
      ...uploadOf('a2', 'alb', late),
      ...uploadOf('a3', 'other', late),
      ...uploadOf('a4', 'other', late, 'rose'),
    ];
    const feed = buildAuditFeed(newestFirst(rows));
    expect(
      feed.map((e) => (e.kind === 'upload' ? [e.actor, e.albumId, e.imported] : e.kind))
    ).toEqual([
      ['rose', 'other', 1],
      ['victor', 'other', 1],
      ['victor', 'alb', 1],
      ['victor', 'alb', 1],
    ]);
  });

  it('counts duplicates apart and ignores the old "simple-upload" placeholder name', () => {
    const rows = [
      row({
        timestamp: '2026-11-25 10:00:00',
        event_type: 'import',
        target_type: 'asset',
        target_id: 'd1',
        details: JSON.stringify({ originalName: 'simple-upload', duplicate: true }),
      }),
    ];
    const [entry] = buildAuditFeed(rows);
    expect(entry.kind === 'upload' && [entry.imported, entry.duplicates, entry.names]).toEqual([
      0,
      1,
      [],
    ]);
  });

  it('sums consecutive deletions of the same actor', () => {
    const rows = [
      row({
        timestamp: '2026-11-26 12:40:28',
        actor: 'maelyne',
        event_type: 'delete',
        target_type: 'asset',
        target_id: 'bulk',
        details: JSON.stringify({ count: 1, ids: ['x1'] }),
      }),
      row({
        timestamp: '2026-11-26 12:40:36',
        actor: 'maelyne',
        event_type: 'delete',
        target_type: 'asset',
        target_id: 'bulk',
        details: JSON.stringify({ count: 2, ids: ['x2', 'x3'] }),
      }),
    ];
    const [entry, ...rest] = buildAuditFeed(newestFirst(rows));
    expect(rest).toHaveLength(0);
    expect(entry.kind === 'assets_deleted' && [entry.count, entry.assetIds]).toEqual([
      3,
      ['x2', 'x3', 'x1'],
    ]);
  });

  it('keeps every cover change as its own entry, with the cover it replaced', () => {
    const rows = ['c1', 'c2'].map((to, i) =>
      row({
        timestamp: `2026-11-26 10:41:3${i}`,
        event_type: 'update',
        target_type: 'album',
        target_id: `album-${i}`,
        details: JSON.stringify({ action: 'set_cover', from: `old-${i}`, to }),
      })
    );
    const feed = buildAuditFeed(newestFirst(rows));
    expect(
      feed.map((e) => (e.kind === 'album_cover' ? [e.albumId, e.from, e.to] : e.kind))
    ).toEqual([
      ['album-1', 'old-1', 'c2'],
      ['album-0', 'old-0', 'c1'],
    ]);
  });

  it('reads an album edit as its changes, and an older row as a state snapshot', () => {
    const [edit, legacy] = buildAuditFeed([
      row({
        timestamp: '2026-11-26 10:00:01',
        event_type: 'update',
        target_type: 'album',
        target_id: 'alb',
        details: JSON.stringify({ changes: { name: ['Monochrome', 'Monochrome 2026'] } }),
      }),
      row({
        timestamp: '2026-11-26 10:00:00',
        event_type: 'update',
        target_type: 'album',
        target_id: 'alb',
        details: JSON.stringify({ name: 'Monochrome', visible: true }),
      }),
    ]);
    expect(edit.kind === 'album_updated' && edit.changes).toEqual({
      name: ['Monochrome', 'Monochrome 2026'],
    });
    expect(legacy.kind === 'album_updated' && [legacy.changes, legacy.snapshot]).toEqual([
      null,
      { name: 'Monochrome', visible: true },
    ]);
  });

  it('never folds a row it cannot read, and keeps it', () => {
    const [entry] = buildAuditFeed([
      row({ timestamp: '2026-11-26 10:00:00', event_type: 'login', details: 'not json' }),
    ]);
    expect(entry.kind === 'other' && [entry.eventType, entry.details]).toEqual([
      'login',
      { value: 'not json' },
    ]);
  });
});

describe('audit-changes', () => {
  it('reports only the fields that moved, with null and undefined as the same absence', () => {
    expect(
      fieldChanges(
        { name: 'A', date: null, location: undefined as string | undefined },
        { name: 'B', date: null, location: null as unknown as string | undefined },
        ['name', 'date', 'location']
      )
    ).toEqual({ name: ['A', 'B'] });
  });

  it('is null for a save that changed nothing, and lists the access moved otherwise', () => {
    const state = {
      name: 'WEI',
      date: '2026-09-18',
      location: null,
      visibility: 'private',
      visible: true,
      access: [{ kind: 'promo', value: '2026' }],
    };
    expect(albumChangeDetails(state, { ...state, access: [...state.access] })).toBeNull();
    expect(
      albumChangeDetails(state, {
        ...state,
        visible: false,
        access: [{ kind: 'promo', value: '2027' }],
      })
    ).toEqual({
      changes: { visible: [true, false] },
      access: {
        added: [{ kind: 'promo', value: '2027' }],
        removed: [{ kind: 'promo', value: '2026' }],
      },
    });
  });
});
