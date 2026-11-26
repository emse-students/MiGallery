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

vi.mock('#lib/server/auth.ts', () => ({ requireAdminPage: () => ({}) }));

let database: typeof import('#lib/db/database.ts');
let load: typeof import('../src/routes/admin/logs/+page.server').load;
let dbDir: string;

beforeAll(async () => {
  dbDir = mkdtempSync(join(tmpdir(), 'migallery-admin-logs-'));
  process.env.DATABASE_PATH = join(dbDir, 'logs.db');
  database = await import('#lib/db/database.ts');
  ({ load } = await import('../src/routes/admin/logs/+page.server'));
});

afterAll(() => {
  database.resetDatabase();
  removeTempDir(dbDir);
});

type LoadResult = {
  entries: { id: number; kind: string; actor: string | null }[];
  people: Record<string, { name: string; role: string | null }>;
  albums: Record<string, string>;
};

const loadAt = async (query = '') =>
  (await load({
    locals: {},
    cookies: {},
    url: new URL(`http://localhost/admin/logs${query}`),
  } as never)) as unknown as LoadResult;

describe('admin logs page', () => {
  it('returns a distinct id per entry when several rows share a timestamp', async () => {
    const db = database.getDatabase();
    const add = db.prepare(
      "INSERT INTO logs (timestamp, event_type, details) VALUES ('2026-01-01 10:00:00', 'login', ?)"
    );
    add.run('a');
    add.run('b');
    add.run('c');

    const result = await loadAt();

    expect(result.entries.length).toBe(3);
    expect(new Set(result.entries.map((e) => e.id)).size).toBe(result.entries.length);
  });

  it('keys the entry loop on the id, never the timestamp', () => {
    const source = readFileSync(join(__dirname, '../src/routes/admin/logs/+page.svelte'), 'utf8');
    expect(source).toContain('{#each day.entries as entry (entry.id)}');
    expect(source).not.toMatch(/\{#each [^}]*\((entry|log)\.(timestamp|start|end)\)\}/);
  });

  it('names the actor and the album, and the covers filter keeps only cover changes', async () => {
    const db = database.getDatabase();
    db.prepare(
      "INSERT INTO users (id_user, name, first_name, last_name, role) VALUES ('u-cover', 'vk', 'Victor', 'K', 'mitviste')"
    ).run();
    db.prepare("INSERT INTO albums (id, name) VALUES ('alb-cover', 'Perm Nauti')").run();
    const add = db.prepare(
      "INSERT INTO logs (timestamp, actor, event_type, target_type, target_id, details) VALUES ('2026-11-26 10:41:48', 'u-cover', 'update', 'album', 'alb-cover', ?)"
    );
    add.run(JSON.stringify({ action: 'set_cover', from: 'old', to: 'new' }));
    add.run(JSON.stringify({ changes: { name: ['Nauti', 'Perm Nauti'] } }));

    const result = await loadAt('?category=covers');

    expect(result.entries.map((e) => e.kind)).toEqual(['album_cover']);
    expect(result.people['u-cover']).toEqual({ name: 'Victor K', role: 'mitviste' });
    expect(result.albums['alb-cover']).toBe('Perm Nauti');
  });
});
