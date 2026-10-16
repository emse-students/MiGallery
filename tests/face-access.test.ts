/**
 * The face-linked photo rule (src/lib/server/face-access.ts), against a throwaway SQLite file.
 *
 * What it pins: a signed-in member reads a face-linked set only when it is their own, or when its
 * owner authorised them, or when they are an admin - and the generic Immich proxy holds the
 * people/faces/search paths to the same rule. Before this rule was enforced server-side, any
 * session read any person's photos and the consent table only steered the UI.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// The assert* functions judge an AuthResult already obtained; authentication itself (and the
// SvelteKit-only modules behind it) is out of the picture.
vi.mock('$lib/server/permissions', () => ({ requireScope: vi.fn() }));
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeTempDir } from './test-helpers';
import type { AuthResult } from '$lib/server/permissions';

let access: typeof import('$lib/server/face-access');
let database: typeof import('$lib/db/database');
let dbDir: string;

const OWNER = { id_user: 'fa-owner', role: 'user' };
const VIEWER = { id_user: 'fa-viewer', role: 'user' };
const STRANGER = { id_user: 'fa-stranger', role: 'user' };
const ADMIN = { id_user: 'fa-admin', role: 'admin' };
const MITVISTE = { id_user: 'fa-mitviste', role: 'mitviste' };
const PERSON = 'aaaaaaaa-0000-0000-0000-000000000001';
const UNLINKED = 'aaaaaaaa-0000-0000-0000-000000000002';

function session(user: { id_user: string; role: string }): AuthResult {
  return { user: user as never, grantedScope: 'read', viaApiKey: false };
}
const API_KEY: AuthResult = { user: null, grantedScope: 'read', viaApiKey: true };

function status(fn: () => void): number {
  try {
    fn();
    return 200;
  } catch (e) {
    return (e as { status?: number }).status ?? 500;
  }
}

beforeAll(async () => {
  dbDir = mkdtempSync(join(tmpdir(), 'migallery-face-access-'));
  process.env.DATABASE_PATH = join(dbDir, 'face-access.db');
  database = await import('$lib/db/database');
  access = await import('$lib/server/face-access');

  const db = database.getDatabase();
  for (const u of [OWNER, VIEWER, STRANGER, ADMIN, MITVISTE]) {
    db.prepare('INSERT INTO users (id_user, name, role, photos_id) VALUES (?, ?, ?, ?)').run(
      u.id_user,
      u.id_user,
      u.role,
      u === OWNER ? PERSON : null
    );
  }
  db.prepare('INSERT INTO photo_access_permissions (owner_id, authorized_id) VALUES (?, ?)').run(
    OWNER.id_user,
    VIEWER.id_user
  );
});

afterAll(() => {
  database.resetDatabase();
  removeTempDir(dbDir);
});

describe('faceAccessReason', () => {
  it('names the reason for the owner, an authorised viewer and an admin', () => {
    expect(access.faceAccessReason(OWNER, OWNER.id_user)).toBe('own_photos');
    expect(access.faceAccessReason(VIEWER, OWNER.id_user)).toBe('granted');
    expect(access.faceAccessReason(ADMIN, OWNER.id_user)).toBe('admin');
  });

  it('refuses a member the owner did not authorise, mitviste included', () => {
    expect(access.faceAccessReason(STRANGER, OWNER.id_user)).toBeNull();
    expect(access.faceAccessReason(MITVISTE, OWNER.id_user)).toBeNull();
  });

  it('a grant is one-way: the owner does not gain access to the viewer', () => {
    expect(access.faceAccessReason(OWNER, VIEWER.id_user)).toBeNull();
  });

  it('a person nobody linked is readable by an admin only', () => {
    expect(access.faceAccessReason(STRANGER, null)).toBeNull();
    expect(access.faceAccessReason(ADMIN, null)).toBe('admin');
  });
});

describe('assertPersonAccess', () => {
  it('maps the Immich person to its owner before applying the rule', () => {
    expect(status(() => access.assertPersonAccess(session(OWNER), PERSON))).toBe(200);
    expect(status(() => access.assertPersonAccess(session(VIEWER), PERSON))).toBe(200);
    expect(status(() => access.assertPersonAccess(session(STRANGER), PERSON))).toBe(403);
    expect(status(() => access.assertPersonAccess(session(STRANGER), UNLINKED))).toBe(403);
    expect(status(() => access.assertPersonAccess(session(ADMIN), UNLINKED))).toBe(200);
    expect(status(() => access.assertPersonAccess(API_KEY, UNLINKED))).toBe(200);
  });
});

describe('assertPhotoCvManager', () => {
  it('lets admin, mitviste and API keys read the whole PhotoCV album, not a member', () => {
    expect(status(() => access.assertPhotoCvManager(session(ADMIN), 'x'))).toBe(200);
    expect(status(() => access.assertPhotoCvManager(session(MITVISTE), 'x'))).toBe(200);
    expect(status(() => access.assertPhotoCvManager(API_KEY, 'x'))).toBe(200);
    expect(status(() => access.assertPhotoCvManager(session(OWNER), 'x'))).toBe(403);
  });
});

describe('assertProxiedFaceAccess (the generic Immich proxy)', () => {
  const q = (s = '') => new URLSearchParams(s);
  const proxy = (
    who: AuthResult,
    method: string,
    path: string,
    query = q(),
    body: unknown = null
  ) => status(() => access.assertProxiedFaceAccess(who, method, path, query, body));

  it('serves a person and its thumbnail to the owner and an authorised viewer only', () => {
    expect(proxy(session(OWNER), 'GET', `people/${PERSON}`)).toBe(200);
    expect(proxy(session(VIEWER), 'GET', `people/${PERSON}/thumbnail`)).toBe(200);
    expect(proxy(session(STRANGER), 'GET', `people/${PERSON}/thumbnail`)).toBe(403);
  });

  it('lets only the owner edit their person; a viewer may look, never edit', () => {
    expect(proxy(session(OWNER), 'PUT', `people/${PERSON}`)).toBe(200);
    expect(proxy(session(VIEWER), 'PUT', `people/${PERSON}`)).toBe(403);
    expect(proxy(session(OWNER), 'DELETE', `people/${PERSON}`)).toBe(403);
    expect(proxy(session(OWNER), 'POST', `people/${PERSON}/merge`)).toBe(403);
    expect(proxy(session(ADMIN), 'DELETE', `people/${PERSON}`)).toBe(200);
  });

  it('keeps the directory, raw faces and person search to admins and API keys', () => {
    for (const path of ['people', 'people/', 'faces', 'search/person']) {
      expect(proxy(session(OWNER), 'GET', path)).toBe(403);
      expect(proxy(session(ADMIN), 'GET', path)).toBe(200);
      expect(proxy(API_KEY, 'GET', path)).toBe(200);
    }
  });

  it('judges the path Immich will route, not its spelling', () => {
    expect(proxy(session(OWNER), 'GET', './people')).toBe(403);
    expect(proxy(session(OWNER), 'GET', 'PEOPLE')).toBe(403);
    expect(proxy(session(OWNER), 'GET', '/faces')).toBe(403);
    expect(proxy(session(STRANGER), 'GET', `People/${PERSON.toUpperCase()}`)).toBe(403);
  });

  it('checks every person a search names, in its body or its query', () => {
    const body = (ids: string[]) => ({ personIds: ids, type: 'IMAGE' });
    expect(proxy(session(OWNER), 'POST', 'search/metadata', q(), body([PERSON]))).toBe(200);
    expect(proxy(session(VIEWER), 'POST', 'search/metadata', q(), body([PERSON]))).toBe(200);
    expect(proxy(session(STRANGER), 'POST', 'search/metadata', q(), body([PERSON]))).toBe(403);
    expect(proxy(session(OWNER), 'POST', 'search/metadata', q(), body([PERSON, UNLINKED]))).toBe(
      403
    );
    expect(proxy(session(STRANGER), 'GET', 'timeline/buckets', q(`personId=${PERSON}`))).toBe(403);
  });

  it('leaves a path that names no person alone', () => {
    expect(proxy(session(STRANGER), 'GET', 'assets/abc/thumbnail')).toBe(200);
    expect(proxy(session(STRANGER), 'POST', 'search/metadata', q(), { type: 'IMAGE' })).toBe(200);
  });
});
