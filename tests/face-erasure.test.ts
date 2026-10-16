/**
 * Face erasure (src/lib/server/face-erasure.ts), against a throwaway SQLite file and a scripted
 * Immich.
 *
 * What it pins: withdrawing a face or deleting an account removes the LOCAL face data in the
 * request, journals the Immich half in the same transaction, and the journal drives Immich to
 * "the person carries no name and no birth date" - retrying a refusal instead of dropping it. The
 * anonymous cluster and its faces stay (owner decision 2026-10-16). Before this, withdrawal only
 * nulled `photos_id` and an account deletion only deleted the row.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';
import { removeTempDir } from './test-helpers';

vi.mock('$env/dynamic/private', () => ({
  env: { IMMICH_BASE_URL: 'http://immich.test', IMMICH_API_KEY: 'k' },
}));

let erasure: typeof import('$lib/server/face-erasure');
let database: typeof import('$lib/db/database');
let dbDir: string;

const PERSON = 'bbbbbbbb-0000-4000-8000-000000000001';
const OTHER_PERSON = 'bbbbbbbb-0000-4000-8000-000000000002';
const PERSON_URL = /\/api\/people\/[\w-]+$/;
const FACE_DIR = path.resolve('data/cache/faces');

type Call = { method: string; url: string; body?: unknown };

/**
 * A scripted Immich holding one named person. It keeps state: a PUT changes the name.
 * - personStatus: what GET /people/{PERSON} answers (200, or the 400 Immich gives for "not found")
 * - refusePut: the PUT is refused with a 500
 * - ignorePut: the PUT answers 200 but changes nothing (a write that did not take)
 * - empty: no asset shows the person (so a 400 really means "gone")
 */
function scriptedImmich(
  opts: {
    refusePut?: boolean;
    ignorePut?: boolean;
    personStatus?: number;
    empty?: boolean;
    named?: boolean;
  } = {}
) {
  const calls: Call[] = [];
  const person = {
    id: PERSON,
    name: opts.named === false ? '' : 'Alice Martin',
    birthDate: opts.named === false ? null : '2001-02-03',
  };
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    if (PERSON_URL.test(url) && method === 'GET') {
      const status = opts.personStatus ?? 200;
      return json(status === 200 ? person : { message: 'Not found or no access' }, status);
    }
    if (PERSON_URL.test(url) && method === 'PUT') {
      if (opts.refusePut) {
        return json({ message: 'boom' }, 500);
      }
      if (!opts.ignorePut) {
        person.name = body.name;
        person.birthDate = body.birthDate;
      }
      return json(person);
    }
    if (url.endsWith('/api/search/metadata')) {
      return json({ assets: { items: opts.empty ? [] : [{ id: 'a1' }], nextPage: null } });
    }
    return json({ message: 'unexpected' }, 418);
  }) as typeof fetch;
  return { calls, fetchFn, person };
}

function addUser(id: string, photosId: string | null) {
  database
    .getDatabase()
    .prepare('INSERT INTO users (id_user, name, photos_id, photos_asset_id) VALUES (?, ?, ?, ?)')
    .run(id, `Name of ${id}`, photosId, photosId ? 'profile-asset' : null);
}

function journal() {
  return database.getDatabase().prepare('SELECT * FROM face_erasures ORDER BY id').all() as Array<
    Record<string, unknown>
  >;
}

beforeAll(async () => {
  dbDir = mkdtempSync(join(tmpdir(), 'migallery-face-erasure-'));
  process.env.DATABASE_PATH = join(dbDir, 'face-erasure.db');
  database = await import('$lib/db/database');
  erasure = await import('$lib/server/face-erasure');
  // The delete paths kick a run on the global fetch: an Immich that is down, so a kicked run
  // records one refused attempt and never reaches the network.
  vi.stubGlobal('fetch', async () => new Response('down', { status: 503 }));
});

afterAll(() => {
  vi.unstubAllGlobals();
  database.resetDatabase();
  removeTempDir(dbDir);
});

beforeEach(() => {
  const db = database.getDatabase();
  db.exec(
    'DELETE FROM face_erasures; DELETE FROM logs; DELETE FROM photo_access_permissions; DELETE FROM users;'
  );
});

describe('the local half', () => {
  it('a withdrawal drops the link, the profile pointer, the grants the member GAVE and (after commit) the crops', () => {
    addUser('owner', PERSON);
    addUser('friend', null);
    const db = database.getDatabase();
    const grant = db.prepare(
      'INSERT INTO photo_access_permissions (owner_id, authorized_id) VALUES (?, ?)'
    );
    grant.run('owner', 'friend');
    grant.run('friend', 'owner');
    fs.mkdirSync(FACE_DIR, { recursive: true });
    const crop = path.join(FACE_DIR, `asset-x_${PERSON}.webp`);
    const centerCrop = path.join(FACE_DIR, 'asset-x_center.webp');
    fs.writeFileSync(crop, 'x');
    fs.writeFileSync(centerCrop, 'x');

    try {
      const local = erasure.inTransaction(db, () =>
        erasure.eraseLocalFaceData(db, 'owner', 'withdrawal')
      );

      expect(local.erasure).not.toBeNull();
      // The crops are files: they go AFTER the commit, so a file error cannot undo the withdrawal.
      expect(fs.existsSync(crop)).toBe(true);
      erasure.finishLocalErasure(local);
      expect(
        db.prepare("SELECT photos_id, photos_asset_id FROM users WHERE id_user = 'owner'").get()
      ).toEqual({ photos_id: null, photos_asset_id: null });
      // Only the grant the owner GAVE goes; the one the friend gave the owner is about the friend's face.
      expect(db.prepare('SELECT owner_id FROM photo_access_permissions').all()).toEqual([
        { owner_id: 'friend' },
      ]);
      expect(fs.existsSync(crop)).toBe(false);
      expect(fs.existsSync(centerCrop)).toBe(true);
      expect(journal()).toMatchObject([{ person_id: PERSON, reason: 'withdrawal', done_at: null }]);
    } finally {
      fs.rmSync(centerCrop, { force: true });
    }
  });

  it('journals nothing when no person was linked', () => {
    addUser('nobody', null);
    const db = database.getDatabase();
    expect(erasure.eraseLocalFaceData(db, 'nobody', 'withdrawal').erasure).toBeNull();
    expect(journal()).toEqual([]);
  });

  it('an account deletion also removes the row and anonymises the audit log', async () => {
    addUser('leaver', PERSON);
    addUser('admin', null);
    const db = database.getDatabase();
    const log = db.prepare(
      'INSERT INTO logs (actor, event_type, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)'
    );
    log.run('leaver', 'upload', 'asset', 'a1', null);
    log.run('admin', 'update', 'user', 'leaver', '{"name":"Name of leaver"}');
    log.run('admin', 'delete', 'person', PERSON, null);
    log.run('admin', 'update', 'album', 'alb', null);

    expect(erasure.deleteUserAccount(db, 'leaver')).toBe(true);
    await erasure.runFaceErasures();

    expect(db.prepare("SELECT 1 FROM users WHERE id_user = 'leaver'").get()).toBeNull();
    const rows = db.prepare('SELECT actor, target_id, details FROM logs ORDER BY id').all();
    expect(rows).toEqual([
      { actor: '[deleted]', target_id: 'a1', details: null },
      { actor: 'admin', target_id: '[deleted]', details: null },
      { actor: 'admin', target_id: '[deleted]', details: null },
      { actor: 'admin', target_id: 'alb', details: null },
    ]);
    expect(journal()).toMatchObject([{ person_id: PERSON, reason: 'account_deletion' }]);
    expect(erasure.deleteUserAccount(db, 'leaver')).toBe(false);
  });
});

describe('the Immich half', () => {
  it('clears the name and the birth date, reads them back, keeps the cluster, forgets the id', async () => {
    addUser('owner', PERSON);
    const db = database.getDatabase();
    erasure.eraseLocalFaceData(db, 'owner', 'withdrawal');
    const immich = scriptedImmich();

    await erasure.runFaceErasures(immich.fetchFn);

    expect(immich.person).toMatchObject({ name: '', birthDate: null });
    expect(immich.calls.filter((c) => c.method === 'PUT').map((c) => c.body)).toEqual([
      { name: '', birthDate: null },
    ]);
    // The cluster stays: nothing is deleted in Immich.
    expect(immich.calls.some((c) => c.method === 'DELETE')).toBe(false);
    expect(journal()).toMatchObject([
      { outcome: 'erased', person_id: null, attempts: 1, last_error: null },
    ]);
  });

  it('writes nothing when the person is already anonymous', async () => {
    addUser('owner', PERSON);
    erasure.eraseLocalFaceData(database.getDatabase(), 'owner', 'withdrawal');
    const immich = scriptedImmich({ named: false });

    await erasure.runFaceErasures(immich.fetchFn);

    expect(immich.calls.some((c) => c.method === 'PUT')).toBe(false);
    expect(journal()).toMatchObject([{ outcome: 'erased' }]);
  });

  it('a refusal is recorded and retried', async () => {
    addUser('owner', PERSON);
    erasure.eraseLocalFaceData(database.getDatabase(), 'owner', 'withdrawal');

    await erasure.runFaceErasures(scriptedImmich({ refusePut: true }).fetchFn);
    expect(journal()).toMatchObject([{ done_at: null, attempts: 1, person_id: PERSON }]);
    expect(String(journal()[0].last_error)).toContain('500');

    await erasure.runFaceErasures(scriptedImmich().fetchFn);
    expect(journal()).toMatchObject([{ outcome: 'erased', attempts: 2, last_error: null }]);
  });

  it('a write that did not take is a failed attempt, not a success', async () => {
    addUser('owner', PERSON);
    erasure.eraseLocalFaceData(database.getDatabase(), 'owner', 'withdrawal');

    await erasure.runFaceErasures(scriptedImmich({ ignorePut: true }).fetchFn);

    expect(journal()).toMatchObject([{ done_at: null, attempts: 1 }]);
    expect(String(journal()[0].last_error)).toContain('still carries');
  });

  it('reports every row pending for more than 24 hours', () => {
    const db = database.getDatabase();
    const now = Date.now();
    const add = db.prepare(
      "INSERT INTO face_erasures (person_id, reason, requested_at) VALUES (?, 'withdrawal', ?)"
    );
    add.run(PERSON, now - erasure.ERASURE_OVERDUE_MS - 1000);
    add.run(OTHER_PERSON, now - 1000);
    expect(erasure.reportOverdue(db, now)).toBe(1);
  });
});

describe('what the review asked to pin', () => {
  it('believes "absent" only when a search by the person finds nothing either', async () => {
    addUser('owner', PERSON);
    const db = database.getDatabase();
    erasure.eraseLocalFaceData(db, 'owner', 'withdrawal');

    // 400 while assets still show the person: Immich refused access, it did not say "gone".
    await erasure.runFaceErasures(scriptedImmich({ personStatus: 400 }).fetchFn);
    expect(journal()).toMatchObject([{ done_at: null, attempts: 1 }]);

    await erasure.runFaceErasures(scriptedImmich({ personStatus: 400, empty: true }).fetchFn);
    expect(journal()).toMatchObject([{ outcome: 'absent', person_id: null }]);
  });

  it('an account deletion also drops its per-user album grants and its addresses in the log', async () => {
    addUser('leaver', null);
    const db = database.getDatabase();
    db.prepare("INSERT INTO albums (id, name) VALUES ('alb-r', 'A')").run();
    const grant = db.prepare(
      "INSERT INTO album_permissions (album_id, kind, value) VALUES ('alb-r', ?, ?)"
    );
    grant.run('user', 'leaver');
    grant.run('promo', '2024');
    db.prepare(
      "INSERT INTO logs (actor, event_type, ip) VALUES ('leaver', 'login', '203.0.113.9')"
    ).run();

    expect(erasure.deleteUserAccount(db, 'leaver')).toBe(true);

    expect(db.prepare('SELECT kind FROM album_permissions').all()).toEqual([{ kind: 'promo' }]);
    expect(db.prepare('SELECT actor, ip FROM logs').all()).toEqual([
      { actor: '[deleted]', ip: null },
    ]);
    db.prepare("DELETE FROM albums WHERE id = 'alb-r'").run();
  });

  it('a run asked for while one is in progress makes one more pass, so a new row is not left waiting', async () => {
    addUser('first', PERSON);
    addUser('second', OTHER_PERSON);
    const db = database.getDatabase();
    erasure.eraseLocalFaceData(db, 'first', 'withdrawal');
    const immich = scriptedImmich({ empty: true, personStatus: 400 });

    const inProgress = erasure.runFaceErasures(immich.fetchFn);
    erasure.eraseLocalFaceData(db, 'second', 'withdrawal');
    void erasure.runFaceErasures(immich.fetchFn);
    await inProgress;

    expect(journal().every((r) => r.done_at !== null)).toBe(true);
  });
});
