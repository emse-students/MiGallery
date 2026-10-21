/**
 * The admin Logs page keys its rows by something unique.
 *
 * What it pins: `timestamp` has one-second resolution (`datetime('now')`), so two events logged in
 * the same second share it and Svelte throws `each_key_duplicate` when it is the `{#each}` key.
 * The load must hand the page a distinct `id` per row even when timestamps collide, and the page
 * must key on that id. There is no DOM environment here, so the template half is read as source.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeTempDir } from './test-helpers';

vi.mock('$lib/server/auth', () => ({ requireAdminPage: () => ({}) }));

let database: typeof import('$lib/db/database');
let load: typeof import('../src/routes/admin/logs/+page.server').load;
let dbDir: string;

beforeAll(async () => {
  dbDir = mkdtempSync(join(tmpdir(), 'migallery-admin-logs-'));
  process.env.DATABASE_PATH = join(dbDir, 'logs.db');
  database = await import('$lib/db/database');
  ({ load } = await import('../src/routes/admin/logs/+page.server'));
});

afterAll(() => {
  database.resetDatabase();
  removeTempDir(dbDir);
});

describe('admin logs page', () => {
  it('returns a distinct id per row when several rows share a timestamp', async () => {
    const db = database.getDatabase();
    const add = db.prepare(
      "INSERT INTO logs (timestamp, event_type, details) VALUES ('2026-01-01 10:00:00', 'login', ?)"
    );
    add.run('a');
    add.run('b');
    add.run('c');

    const result = (await load({
      locals: {},
      cookies: {},
      url: new URL('http://localhost/admin/logs'),
    } as never)) as { logs: { id: number; timestamp: string }[] };

    expect(new Set(result.logs.map((l) => l.timestamp)).size).toBe(1);
    expect(new Set(result.logs.map((l) => l.id)).size).toBe(result.logs.length);
  });

  it('keys the row loop on the id, never the timestamp', () => {
    const source = readFileSync(join(__dirname, '../src/routes/admin/logs/+page.svelte'), 'utf8');
    expect(source).toContain('{#each logs as log (log.id)}');
    expect(source).not.toContain('log (log.timestamp)');
  });
});
