/**
 * The two avatar-link revocation routes, called as handlers against a throwaway SQLite file with
 * the authentication helpers stubbed: unauthenticated -> 401, not an admin -> 403, success writes
 * the revocation for that user only, an unknown user -> 404.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { error } from '@sveltejs/kit';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeTempDir } from './test-helpers';

const auth = vi.hoisted(() => ({
  session: null as null | { id_user: string },
  admin: false,
  impersonating: false,
}));

vi.mock('$lib/server/auth', () => ({ isImpersonating: () => auth.impersonating }));

vi.mock('$lib/server/permissions', () => ({
  requireSession: async () => {
    if (!auth.session) throw error(401, 'Unauthorized');
    return auth.session;
  },
  requireScope: async () => {
    if (!auth.session) throw error(401, 'Unauthorized');
    if (!auth.admin) throw error(403, 'Forbidden');
    return { user: auth.session, grantedScope: 'admin', viaApiKey: false };
  },
}));
vi.mock('$lib/server/logs', () => ({ logEvent: vi.fn() }));

let database: typeof import('$lib/db/database');
let revocation: typeof import('$lib/server/avatar-revocation');
let me: typeof import('../src/routes/api/users/me/avatar-link/+server');
let byId: typeof import('../src/routes/api/users/[id]/avatar-link/+server');
let dbDir: string;

const call = async (fn: (e: never) => unknown, event: object) => {
  try {
    return ((await fn(event as never)) as Response).status;
  } catch (e) {
    return (e as { status: number }).status;
  }
};

beforeAll(async () => {
  dbDir = mkdtempSync(join(tmpdir(), 'migallery-avatar-routes-'));
  process.env.DATABASE_PATH = join(dbDir, 'routes.db');
  database = await import('$lib/db/database');
  revocation = await import('$lib/server/avatar-revocation');
  me = await import('../src/routes/api/users/me/avatar-link/+server');
  byId = await import('../src/routes/api/users/[id]/avatar-link/+server');
  const add = database.getDatabase().prepare('INSERT INTO users (id_user, name) VALUES (?, ?)');
  add.run('alice', 'Alice');
  add.run('bob', 'Bob');
  add.run('carol', 'Carol');
});

afterAll(() => {
  database.resetDatabase();
  removeTempDir(dbDir);
});

const salt = (id: string) => revocation.avatarSaltOf(database.getDatabase(), id);

describe('DELETE /api/users/me/avatar-link', () => {
  it('refuses an anonymous caller', async () => {
    auth.session = null;
    expect(await call(me.DELETE, {})).toBe(401);
    expect(salt('alice')).toBeNull();
  });

  it('revokes the signed-in user only', async () => {
    auth.session = { id_user: 'alice' };
    expect(await call(me.DELETE, {})).toBe(200);
    expect(salt('alice')).not.toBeNull();
    expect(salt('bob')).toBeNull();
  });
});

describe('while impersonating', () => {
  it('refuses both revocations and writes nothing', async () => {
    auth.session = { id_user: 'alice' };
    auth.admin = true;
    auth.impersonating = true;
    expect(await call(me.DELETE, {})).toBe(403);
    expect(await call(byId.DELETE, { params: { id: 'carol' } })).toBe(403);
    auth.impersonating = false;
    expect(salt('carol')).toBeNull();
  });
});

describe('DELETE /api/users/[id]/avatar-link', () => {
  it('refuses anonymous (401) and a non-admin (403)', async () => {
    auth.session = null;
    expect(await call(byId.DELETE, { params: { id: 'bob' } })).toBe(401);
    auth.session = { id_user: 'alice' };
    auth.admin = false;
    expect(await call(byId.DELETE, { params: { id: 'bob' } })).toBe(403);
    expect(salt('bob')).toBeNull();
  });

  it('lets an admin revoke another user, and reports an unknown one', async () => {
    auth.session = { id_user: 'alice' };
    auth.admin = true;
    expect(await call(byId.DELETE, { params: { id: 'bob' } })).toBe(200);
    expect(salt('bob')).not.toBeNull();
    expect(await call(byId.DELETE, { params: { id: 'nobody' } })).toBe(404);
  });
});
