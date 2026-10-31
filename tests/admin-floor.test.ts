/**
 * The last-admin floor (src/lib/server/admin-floor.ts), through the three routes that can take
 * the admin role away - DELETE /api/users/me, PUT and DELETE /api/users/[id] - called as handlers
 * against a throwaway SQLite file with the authentication helpers stubbed.
 *
 * What it pins: no write may leave zero accounts with the `admin` role, and a refused write
 * changes nothing. An API key carries no user, so the routes' self-demotion and self-deletion
 * guards never covered the last admin; this floor does.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { error } from '@sveltejs/kit';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeTempDir } from './test-helpers';

const auth = vi.hoisted(() => ({
  // null user = an admin API key, which names no account.
  user: null as null | { id_user: string },
}));

vi.mock('#lib/server/auth.ts', () => ({ isImpersonating: () => false }));
vi.mock('#lib/server/permissions.ts', () => ({
  requireSession: async () => {
    if (!auth.user) throw error(401, 'Unauthorized');
    return auth.user;
  },
  requireScope: async () => ({ user: auth.user, grantedScope: 'admin', viaApiKey: !auth.user }),
}));
vi.mock('#lib/server/logs.ts', () => ({ logEvent: vi.fn() }));
vi.mock('#lib/session.ts', () => ({ clearSessionCookie: vi.fn() }));

let database: typeof import('#lib/db/database.ts');
let me: typeof import('../src/routes/api/users/me/+server');
let byId: typeof import('../src/routes/api/users/[id]/+server');
let dbDir: string;

const status = async (fn: (e: never) => unknown, event: object) => {
  try {
    return ((await fn(event as never)) as Response).status;
  } catch (e) {
    return (e as { status: number }).status;
  }
};
const cookies = {};
const putRole = (id: string, role: string) => ({
  params: { id },
  request: new Request('http://x', { method: 'PUT', body: JSON.stringify({ name: id, role }) }),
});
const roles = () =>
  Object.fromEntries(
    (
      database.getDatabase().prepare('SELECT id_user, role FROM users').all() as Array<{
        id_user: string;
        role: string;
      }>
    ).map((r) => [r.id_user, r.role])
  );

function seed(users: Record<string, string>) {
  const db = database.getDatabase();
  db.exec('DELETE FROM users');
  const add = db.prepare('INSERT INTO users (id_user, name, role) VALUES (?, ?, ?)');
  for (const [id, role] of Object.entries(users)) add.run(id, id, role);
}

beforeAll(async () => {
  dbDir = mkdtempSync(join(tmpdir(), 'migallery-admin-floor-'));
  process.env.DATABASE_PATH = join(dbDir, 'floor.db');
  // A deletion kicks the face-erasure run on the global fetch: an Immich that is down.
  vi.stubGlobal('fetch', async () => new Response('down', { status: 503 }));
  database = await import('#lib/db/database.ts');
  me = await import('../src/routes/api/users/me/+server');
  byId = await import('../src/routes/api/users/[id]/+server');
});

afterAll(() => {
  vi.unstubAllGlobals();
  database.resetDatabase();
  removeTempDir(dbDir);
});

beforeEach(() => {
  auth.user = null;
});

describe('the last admin', () => {
  it('cannot delete their own account', async () => {
    seed({ root: 'admin', member: 'user' });
    auth.user = { id_user: 'root' };
    expect(await status(me.DELETE, { cookies })).toBe(409);
    expect(roles()).toEqual({ root: 'admin', member: 'user' });
  });

  it('cannot be deleted through an API key', async () => {
    seed({ root: 'admin', member: 'user' });
    expect(await status(byId.DELETE, { params: { id: 'root' } })).toBe(409);
    expect(roles()).toEqual({ root: 'admin', member: 'user' });
  });

  it('cannot be demoted through an API key, nor by a PUT that omits the role', async () => {
    seed({ root: 'admin', member: 'user' });
    expect(await status(byId.PUT, putRole('root', 'user'))).toBe(409);
    expect(await status(byId.PUT, putRole('root', 'mitviste'))).toBe(409);
    const noRole = {
      params: { id: 'root' },
      request: new Request('http://x', { method: 'PUT', body: JSON.stringify({ name: 'root' }) }),
    };
    expect(await status(byId.PUT, noRole)).toBe(409);
    expect(roles()).toEqual({ root: 'admin', member: 'user' });
  });

  it('can still be edited while staying admin', async () => {
    seed({ root: 'admin' });
    expect(await status(byId.PUT, putRole('root', 'admin'))).toBe(200);
  });
});

describe('with two admins', () => {
  it('one may leave, and then the other may not', async () => {
    seed({ a: 'admin', b: 'admin' });
    auth.user = { id_user: 'a' };
    expect(await status(me.DELETE, { cookies })).toBe(200);
    auth.user = { id_user: 'b' };
    expect(await status(me.DELETE, { cookies })).toBe(409);
    expect(roles()).toEqual({ b: 'admin' });
  });

  it('demoting each other at the same time leaves exactly one', async () => {
    seed({ a: 'admin', b: 'admin' });
    // Each PUT reads the count inside its own BEGIN IMMEDIATE transaction, so the second one
    // sees the first one's commit whatever order they land in.
    auth.user = null;
    const results = await Promise.all([
      status(byId.PUT, putRole('a', 'user')),
      status(byId.PUT, putRole('b', 'user')),
    ]);
    expect(results.toSorted()).toEqual([200, 409]);
    expect(Object.values(roles()).filter((r) => r === 'admin')).toHaveLength(1);
  });

  it('a non-admin is deleted and demoted freely', async () => {
    seed({ a: 'admin', m: 'mitviste', u: 'user' });
    expect(await status(byId.PUT, putRole('m', 'user'))).toBe(200);
    expect(await status(byId.DELETE, { params: { id: 'u' } })).toBe(200);
    expect(roles()).toEqual({ a: 'admin', m: 'user' });
  });
});
