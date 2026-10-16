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
vi.mock('$env/dynamic/private', () => ({
  env: { IMMICH_BASE_URL: 'http://immich.test', IMMICH_API_KEY: 'k' },
}));
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
    // The owner's own person in capitals is still theirs; a stranger's capitals are no key.
    expect(proxy(session(OWNER), 'GET', `People/${PERSON.toUpperCase()}`)).toBe(200);
    expect(proxy(session(STRANGER), 'GET', `People/${PERSON.toUpperCase()}`)).toBe(403);
  });

  it('refuses a path that would smuggle its own query string past the check', () => {
    // The path param arrives decoded: `timeline/buckets%3FpersonId=...` becomes this.
    expect(proxy(session(STRANGER), 'GET', `timeline/buckets?personId=${PERSON}`)).toBe(400);
    expect(proxy(session(OWNER), 'GET', 'assets#x')).toBe(400);
  });

  it('treats PATCH on a person as an edit, like PUT', () => {
    expect(proxy(session(OWNER), 'PATCH', `people/${PERSON}`)).toBe(200);
    expect(proxy(session(VIEWER), 'PATCH', `people/${PERSON}`)).toBe(403);
  });

  it('a person id in capitals or under another query key is still checked', () => {
    const upper = PERSON.toUpperCase();
    expect(proxy(session(STRANGER), 'POST', 'search/metadata', q(), { personIds: [upper] })).toBe(
      403
    );
    expect(proxy(session(OWNER), 'POST', 'search/metadata', q(), { personIds: [upper] })).toBe(200);
    expect(proxy(session(STRANGER), 'GET', 'timeline/buckets', q(`personIds[]=${PERSON}`))).toBe(
      403
    );
    expect(proxy(session(STRANGER), 'GET', 'x', q(`personIds=${UNLINKED},${PERSON}`))).toBe(403);
  });

  it('keeps a search listing the people of every result to admins', () => {
    expect(proxy(session(OWNER), 'POST', 'search/metadata', q(), { withPeople: true })).toBe(403);
    expect(proxy(session(OWNER), 'GET', 'search/random', q('withPeople=true'))).toBe(403);
    expect(proxy(session(ADMIN), 'POST', 'search/metadata', q(), { withPeople: true })).toBe(200);
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

  it('so the owner lookup does not depend on the spelling', () => {
    expect(access.findPersonOwner(PERSON.toUpperCase())).toBe(OWNER.id_user);
  });
});

describe('selfieProves (the checks a member passes to link a new person; NOT an identity proof)', () => {
  const ASSET = 'cccccccc-0000-4000-8000-000000000001';
  const OTHERS = 'cccccccc-0000-4000-8000-000000000002';
  const DUP = 'cccccccc-0000-4000-8000-000000000003';
  const immich = (asset: unknown, status = 200) =>
    (async () => new Response(JSON.stringify(asset), { status })) as unknown as typeof fetch;
  const fresh = new Date().toISOString();
  const solo = () => immich({ createdAt: fresh, people: [{ id: PERSON.toUpperCase() }] });

  beforeAll(() => {
    // The proxy's audit rows: who uploaded what (finishImmichUpload writes them).
    const add = database
      .getDatabase()
      .prepare(
        "INSERT INTO logs (actor, event_type, target_type, target_id, details) VALUES (?, 'import', 'asset', ?, ?)"
      );
    add.run(STRANGER.id_user, ASSET, '{"duplicate":false}');
    add.run(OWNER.id_user, OTHERS, '{"duplicate":false}');
    add.run(STRANGER.id_user, DUP, '{"duplicate":true}');
  });

  it('accepts a fresh upload of the caller showing exactly that person, in any case', async () => {
    expect((await access.selfieProves(solo(), ASSET, PERSON, STRANGER.id_user)).ok).toBe(true);
  });

  it('refuses an asset someone else uploaded, or a re-upload of a known file', async () => {
    expect((await access.selfieProves(solo(), OTHERS, PERSON, STRANGER.id_user)).ok).toBe(false);
    expect((await access.selfieProves(solo(), DUP, PERSON, STRANGER.id_user)).ok).toBe(false);
  });

  it('refuses an old asset, another person, several people, no asset or an Immich refusal', async () => {
    const old = new Date(Date.now() - access.SELFIE_MAX_AGE_MS - 60_000).toISOString();
    const cases: Array<[typeof fetch, unknown]> = [
      [immich({ createdAt: old, people: [{ id: PERSON }] }), ASSET],
      [immich({ createdAt: fresh, people: [{ id: UNLINKED }] }), ASSET],
      [immich({ createdAt: fresh, people: [{ id: PERSON }, { id: UNLINKED }] }), ASSET],
      [immich({ createdAt: fresh, people: [{ id: PERSON }] }), undefined],
      [immich({ message: 'no' }, 404), ASSET],
    ];
    for (const [fetchFn, asset] of cases) {
      expect((await access.selfieProves(fetchFn, asset, PERSON, STRANGER.id_user)).ok).toBe(false);
    }
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

describe('assertProxiedFaceAccess with a personIds string', () => {
  it('checks each id of a plain string or comma list too', () => {
    const run = (body: unknown) => {
      try {
        access.assertProxiedFaceAccess(
          session(STRANGER),
          'POST',
          'search/metadata',
          new URLSearchParams(),
          body
        );
        return 200;
      } catch (e) {
        return (e as { status?: number }).status ?? 500;
      }
    };
    expect(run({ personIds: PERSON })).toBe(403);
    expect(run({ personIds: `${UNLINKED},${PERSON}` })).toBe(403);
  });
});
