/**
 * The face-matched photo rule (src/lib/server/face-access.ts), against a throwaway SQLite file.
 *
 * What it pins: a signed-in member reads another member's photos only when they are their own, or
 * when the owner authorised them, or when they are an admin - keyed on the OWNER's user id (lot
 * A6), never on an Immich person - and the generic Immich proxy refuses every person and face
 * call, whoever asks: the check takes no credential at all.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// The assert* functions judge an AuthResult already obtained; authentication itself (and the
// SvelteKit-only modules behind it) is out of the picture.
vi.mock('#lib/server/permissions.ts', () => ({ requireScope: vi.fn() }));
vi.mock('#lib/server/env.ts', () => ({
  env: { IMMICH_BASE_URL: 'http://immich.test', IMMICH_API_KEY: 'k' },
}));
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeTempDir } from './test-helpers';
import type { AuthResult } from '#lib/server/permissions.ts';

let access: typeof import('#lib/server/face-access.ts');
let database: typeof import('#lib/db/database.ts');
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
  database = await import('#lib/db/database.ts');
  access = await import('#lib/server/face-access.ts');

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

  it('an admin reads any member, even one who never enrolled', () => {
    expect(access.faceAccessReason(ADMIN, STRANGER.id_user)).toBe('admin');
  });
});

describe('assertMemberPhotosAccess (keyed on the owner user id)', () => {
  const read = (who: AuthResult, ownerId: string) =>
    status(() => access.assertMemberPhotosAccess(who, ownerId));

  it('lets the owner, an authorised viewer, an admin and an API key read; nobody else', () => {
    expect(read(session(OWNER), OWNER.id_user)).toBe(200);
    expect(read(session(VIEWER), OWNER.id_user)).toBe(200);
    expect(read(session(ADMIN), OWNER.id_user)).toBe(200);
    expect(read(API_KEY, OWNER.id_user)).toBe(200);
    expect(read(session(STRANGER), OWNER.id_user)).toBe(403);
    expect(read(session(MITVISTE), OWNER.id_user)).toBe(403);
  });

  it('never reads a person id: naming the owner person instead of the owner refuses', () => {
    expect(read(session(OWNER), PERSON)).toBe(403);
    expect(read(session(VIEWER), PERSON)).toBe(403);
  });

  it('a grant is one-way', () => {
    expect(read(session(OWNER), VIEWER.id_user)).toBe(403);
  });

  it('a session with no user is refused', () => {
    expect(read({ user: null, grantedScope: 'read', viaApiKey: false }, OWNER.id_user)).toBe(403);
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

describe('assertNoProxiedFaceCall (the generic Immich proxy)', () => {
  const q = (s = '') => new URLSearchParams(s);
  const proxy = (method: string, path: string, query = q(), body: unknown = null) =>
    status(() => access.assertNoProxiedFaceCall(method, path, query, body));

  it('refuses every person and face path, whatever the method', () => {
    for (const method of ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE']) {
      for (const path of [
        'people',
        'people/',
        `people/${PERSON}`,
        `people/${PERSON}/thumbnail`,
        `people/${PERSON}/merge`,
        'people/statistics',
        'faces',
        `faces/${PERSON}`,
        'search/person',
      ]) {
        expect(proxy(method, path)).toBe(403);
      }
    }
  });

  it('judges the path Immich will route, not its spelling', () => {
    for (const path of ['./people', 'PEOPLE', '/faces', `People/${PERSON.toUpperCase()}`]) {
      expect(proxy('GET', path)).toBe(403);
    }
    expect(proxy('GET', 'search//person')).toBe(403);
    expect(proxy('GET', 'assets/../people')).toBe(403);
  });

  it('refuses a path that would smuggle its own query string past the check', () => {
    // The path param arrives decoded: `timeline/buckets%3FpersonId=...` becomes this.
    expect(proxy('GET', `timeline/buckets?personId=${PERSON}`)).toBe(400);
    expect(proxy('GET', 'assets#x')).toBe(400);
  });

  it('refuses any query key naming people, in any spelling, whatever its value', () => {
    for (const query of [
      `personId=${PERSON}`,
      `personIds=${PERSON}`,
      `personIds[]=${PERSON}`,
      `PersonId=${UNLINKED}`,
      'withPeople=true',
      'withPeople=false',
      'WITHPEOPLE=1',
    ]) {
      expect(proxy('GET', 'timeline/buckets', q(query))).toBe(403);
    }
  });

  it('refuses any body key naming people, whatever its value, even empty', () => {
    for (const body of [
      { personIds: [PERSON] },
      { personIds: [] },
      { personIds: PERSON },
      { personId: UNLINKED },
      { PersonIds: [PERSON] },
      { withPeople: true },
      { withPeople: false, type: 'IMAGE' },
      { filter: { or: [{ id: { eq: 'a' } }, { personId: { eq: PERSON } }] } },
      { filter: { personIds: [] } },
    ]) {
      expect(proxy('POST', 'search/metadata', q(), body)).toBe(403);
    }
  });

  it('refuses a body too deep to judge', () => {
    let deep: unknown = { type: 'IMAGE' };
    for (let i = 0; i < 40; i++) deep = { filter: deep };
    expect(proxy('POST', 'search/metadata', q(), deep)).toBe(400);
  });

  it('leaves a call that names no person alone', () => {
    expect(proxy('GET', 'assets/abc/thumbnail')).toBe(200);
    expect(proxy('POST', 'search/metadata', q(), { type: 'IMAGE' })).toBe(200);
    expect(
      proxy('POST', 'search/metadata', q(), { filter: { or: [{ id: { eq: 'a' } }] }, size: 2 })
    ).toBe(200);
    expect(proxy('GET', 'albums', q('shared=true'))).toBe(200);
    expect(proxy('GET', 'peoplefinder')).toBe(200);
  });
});

describe('stripFaceFields (what an Immich answer may carry to a client)', () => {
  it('removes people and unassigned faces at any depth, and says how many went', () => {
    const answer = {
      id: 'a1',
      people: [{ id: PERSON, faces: [{ boundingBoxX1: 1 }] }],
      unassignedFaces: [{ boundingBoxX1: 2 }],
      album: { assets: [{ id: 'a2', people: [] }] },
    };
    expect(access.stripFaceFields(answer)).toBe(3);
    expect(answer).toEqual({ id: 'a1', album: { assets: [{ id: 'a2' }] } });
  });

  it('refuses an answer nested past the bound instead of cleaning it partly', () => {
    let deep: Record<string, unknown> = { people: [{ id: PERSON }] };
    for (let i = 0; i < 40; i++) {
      deep = { child: deep };
    }
    expect(() => access.stripFaceFields(deep)).toThrow(access.FaceFieldsTooDeepError);
  });

  it('leaves an answer without them untouched', () => {
    const answer = { id: 'a1', exifInfo: { make: 'x' } };
    expect(access.stripFaceFields(answer)).toBe(0);
    expect(answer).toEqual({ id: 'a1', exifInfo: { make: 'x' } });
  });
});

describe('resolveAdminPersonLink (admin writes of users.photos_id)', () => {
  it('leaves an absent value alone, clears null, normalises the spelling', () => {
    expect(access.resolveAdminPersonLink(undefined, STRANGER.id_user)).toEqual({
      ok: true,
      personId: undefined,
    });
    expect(access.resolveAdminPersonLink(null, STRANGER.id_user)).toEqual({
      ok: true,
      personId: null,
    });
    expect(access.resolveAdminPersonLink(UNLINKED.toUpperCase(), STRANGER.id_user)).toEqual({
      ok: true,
      personId: UNLINKED,
    });
  });

  it('refuses a person another member holds, in any case, and a non-string', () => {
    expect(access.resolveAdminPersonLink(PERSON.toUpperCase(), STRANGER.id_user)).toEqual({
      ok: false,
      reason: 'taken',
    });
    expect(access.resolveAdminPersonLink(42, STRANGER.id_user)).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it('lets the holder keep their own person', () => {
    expect(access.resolveAdminPersonLink(PERSON, OWNER.id_user)).toEqual({
      ok: true,
      personId: PERSON,
    });
  });
});

describe('normalisePersonId', () => {
  it('accepts a UUID in any case and returns it lowercase, refuses anything else', () => {
    expect(access.normalisePersonId(PERSON.toUpperCase())).toBe(PERSON);
    expect(access.normalisePersonId(` ${PERSON} `)).toBe(PERSON);
    expect(access.normalisePersonId('test-person-id')).toBeNull();
    expect(access.normalisePersonId(42)).toBeNull();
  });
});

describe('classifyProxiedBody (what body the proxy can judge)', () => {
  it('judges JSON whatever its case or parameters', () => {
    expect(access.classifyProxiedBody('POST', 'search/metadata', 'Application/JSON', false)).toBe(
      'json'
    );
    expect(
      access.classifyProxiedBody('POST', 'x', 'application/json; charset=utf-16le', false)
    ).toBe('json');
  });

  it('refuses a body type Immich parses but the check cannot read', () => {
    for (const ct of ['application/x-www-form-urlencoded', 'text/plain', 'application/xml']) {
      expect(access.classifyProxiedBody('POST', 'search/metadata', ct, false)).toBe('refused');
    }
  });

  it('lets the two upload shapes through, and only on their own route', () => {
    const multipart = 'multipart/form-data; boundary=----json-boundary';
    expect(access.classifyProxiedBody('POST', 'assets', multipart, false)).toBe('upload');
    expect(access.classifyProxiedBody('POST', 'search/metadata', multipart, false)).toBe('refused');
    expect(access.classifyProxiedBody('POST', 'assets', 'application/octet-stream', true)).toBe(
      'upload'
    );
    expect(access.classifyProxiedBody('POST', 'assets', 'application/octet-stream', false)).toBe(
      'refused'
    );
  });

  it('leaves bodiless requests alone', () => {
    expect(access.classifyProxiedBody('GET', 'people', 'text/plain', false)).toBe('none');
    expect(access.classifyProxiedBody('DELETE', 'assets', null, false)).toBe('none');
  });
});
