/**
 * The Alumni merge's MiGallery half (`#lib/server/alumni-merge/*`, `POST /api/internal/alumni-merge`),
 * against a throwaway SQLite file, a local ES256 key standing in for Canari's handoff key, and a
 * test face key.
 *
 * What it pins (Canari's docs/wiki/profiles-and-access.md D52-D54, the owner's decision of
 * 2026-11-26 item 9): the duplicate's favourites, grants on both sides, album grants and locale
 * move; its face enrolment moves WITH its consent rows, unchanged, every sealed template re-sealed
 * for the target and opening only there, and nothing journalled to Immich for the moved link; when
 * the target already holds face data it keeps it and the duplicate's is erased and journalled; the
 * duplicate is gone; a replay is `absent`; the erase-only mode moves nothing; a duplicate admin and
 * an unreadable template are refused writing nothing; a missing face key is retried writing nothing;
 * every token refusal; the schema walk over every table naming a user; no log line carries a full
 * subject, a name or a token.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { randomBytes as cryptoRandomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWTVerifyGetKey } from 'jose';
import { removeTempDir } from './test-helpers';

const ISSUER = 'https://canari.example';
const FACE_KEY_HEX = 'ab'.repeat(32);

vi.mock('#lib/server/env.ts', () => ({
  env: {
    CANARI_HANDOFF_ISSUER: 'https://canari.example',
    FACE_STORE_KEY: 'ab'.repeat(32),
    IMMICH_BASE_URL: 'http://immich.test',
    IMMICH_API_KEY: 'k',
  },
}));

let database: typeof import('#lib/db/database.ts');
let endpoint: typeof import('#lib/server/alumni-merge/endpoint.ts');
let merge: typeof import('#lib/server/alumni-merge/merge.ts');
let sealing: typeof import('#lib/server/face-seal.ts');
let envModule: typeof import('#lib/server/env.ts');
let dbDir: string;
let privateKey: CryptoKey;
let keys: JWTVerifyGetKey;
const logged: string[] = [];

const subject = () => cryptoRandomBytes(32).toString('hex');
let DUP: string;
let TARGET: string;
let OTHER: string;
const MODEL = 'buffalo_l';
const faceKey = Buffer.from(FACE_KEY_HEX, 'hex');

beforeAll(async () => {
  dbDir = mkdtempSync(join(tmpdir(), 'migallery-alumni-merge-'));
  process.env.DATABASE_PATH = join(dbDir, 'merge.db');
  process.env.LOG_LEVEL = 'debug';
  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logged.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    });
  }
  // Immich is never reached: a journalled erasure's run meets a refusal and is retried later.
  vi.stubGlobal('fetch', async () => new Response('{}', { status: 500 }));
  const pair = await generateKeyPair('ES256');
  privateKey = pair.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'ES256', use: 'sig' };
  keys = createLocalJWKSet({ keys: [jwk] });
  database = await import('#lib/db/database.ts');
  envModule = await import('#lib/server/env.ts');
  sealing = await import('#lib/server/face-seal.ts');
  merge = await import('#lib/server/alumni-merge/merge.ts');
  endpoint = await import('#lib/server/alumni-merge/endpoint.ts');
});

afterAll(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete process.env.LOG_LEVEL;
  database.resetDatabase();
  removeTempDir(dbDir);
});

const db = () => database.getDatabase();

async function token(
  claims: Record<string, unknown>,
  opts: { typ?: string; iss?: string; aud?: string; iat?: number; exp?: number } = {}
): Promise<string> {
  const iat = opts.iat ?? Math.floor(Date.now() / 1000);
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'ES256', typ: opts.typ ?? 'canari-merge+jwt', kid: 'k1' })
    .setIssuer(opts.iss ?? ISSUER)
    .setAudience(opts.aud ?? 'migallery')
    .setIssuedAt(iat)
    .setExpirationTime(opts.exp ?? iat + 60)
    .sign(privateKey);
}

async function call(
  claims: Record<string, unknown> = { dup: DUP, target: TARGET, jti: 'job-1' },
  opts: Parameters<typeof token>[1] = {}
) {
  return endpoint.handleAlumniMergeCall({
    authorization: `Bearer ${await token(claims, opts)}`,
    keys,
  });
}

function addUser(id: string, fields: Record<string, unknown> = {}) {
  const row = {
    name: 'Bea Martin',
    first_name: 'Bea',
    last_name: 'Martin',
    role: 'user',
    promo: 2019,
    formation: 'ICM',
    locale: null,
    photos_id: null,
    photos_asset_id: null,
    photos_asset_source: null,
    ...fields,
  };
  db()
    .prepare(
      `INSERT INTO users (id_user, name, first_name, last_name, role, promo, formation, locale,
         photos_id, photos_asset_id, photos_asset_source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      row.name,
      row.first_name,
      row.last_name,
      row.role,
      row.promo,
      row.formation,
      row.locale,
      row.photos_id,
      row.photos_asset_id,
      row.photos_asset_source
    );
}

const embedding = (seed: number) =>
  new Uint8Array(Array.from({ length: 16 }, (_, i) => (seed + i) % 256));

/** A full face enrolment for `userId`: link, consent, references, negative, ledger, matches. */
function enrol(userId: string, person: string, consentAt = 1_700_000_000_000) {
  db()
    .prepare(
      "UPDATE users SET photos_id = ?, photos_asset_id = 'asset-avatar', photos_asset_source = 'chosen' WHERE id_user = ?"
    )
    .run(person, userId);
  db()
    .prepare(
      "INSERT INTO face_consents (user_id, created_at, version, source) VALUES (?, ?, '2026-10-31', 'selfie')"
    )
    .run(userId, consentAt);
  for (const seed of [1, 2]) {
    db()
      .prepare(
        "INSERT INTO face_references (user_id, model, source, sealed, created_at) VALUES (?, ?, 'selfie', ?, 1)"
      )
      .run(
        userId,
        MODEL,
        sealing.seal(faceKey, sealing.referenceContext(userId, MODEL), embedding(seed))
      );
  }
  db()
    .prepare(
      "INSERT INTO face_negatives (user_id, model, asset_id, face_index, sealed, created_at) VALUES (?, ?, 'neg-asset', 0, ?, 1)"
    )
    .run(
      userId,
      MODEL,
      sealing.seal(faceKey, sealing.negativeContext(userId, MODEL), embedding(9))
    );
  db()
    .prepare(
      "INSERT INTO face_reference_ledger (user_id, model, version, saved_at, source, sealed, created_at) VALUES (?, ?, 1, 1, 'photo', ?, 1)"
    )
    .run(
      userId,
      MODEL,
      sealing.seal(faceKey, sealing.referenceContext(userId, MODEL), embedding(5))
    );
  db()
    .prepare(
      `INSERT INTO face_matches (asset_id, face_index, model, user_id, distance, band, state, created_at)
       VALUES (?, 0, ?, ?, 0.3, 'auto', 'confirmed', 1)`
    )
    .run(`m-${userId.slice(0, 6)}`, MODEL, userId);
  db()
    .prepare(
      'INSERT INTO face_reference_selection (user_id, model, version, selected_at) VALUES (?, ?, 1, 1)'
    )
    .run(userId, MODEL);
}

const FACE_TABLES = [
  'face_consents',
  'face_references',
  'face_negatives',
  'face_reference_ledger',
  'face_reference_selection',
  'face_match_ledger',
  'face_avatar_ledger',
  'face_rematch_pending',
  'face_matches',
] as const;

const count = (table: string, where: string, ...args: unknown[]) =>
  (
    db()
      .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`)
      .get(...(args as never[])) as {
      n: number;
    }
  ).n;
const userRow = (id: string) =>
  db().prepare('SELECT * FROM users WHERE id_user = ?').get(id) as Record<string, unknown> | null;

beforeEach(() => {
  DUP = subject();
  TARGET = subject();
  OTHER = subject();
  db().exec(`
    DELETE FROM face_matches; DELETE FROM face_references; DELETE FROM face_negatives;
    DELETE FROM face_reference_ledger; DELETE FROM face_reference_selection; DELETE FROM face_consents;
    DELETE FROM face_erasures; DELETE FROM album_permissions; DELETE FROM albums;
    DELETE FROM user_favorites; DELETE FROM photo_access_permissions; DELETE FROM sessions;
    DELETE FROM handoff_redemptions; DELETE FROM users;`);
  db().exec("INSERT INTO albums (id, name) VALUES ('album-1', 'A'), ('album-2', 'B')");
  logged.length = 0;
});

describe('the transfer', () => {
  it('moves everything the duplicate owns onto a target created here, and erases the duplicate', async () => {
    addUser(DUP, { locale: 'en' });
    addUser(OTHER, { name: 'Alex Durand' });
    enrol(DUP, 'bbbbbbbb-0000-4000-8000-000000000001');
    db()
      .prepare("INSERT INTO user_favorites (user_id, asset_id) VALUES (?, 'fav-1'), (?, 'fav-2')")
      .run(DUP, DUP);
    db()
      .prepare(
        'INSERT INTO photo_access_permissions (owner_id, authorized_id) VALUES (?, ?), (?, ?)'
      )
      .run(DUP, OTHER, OTHER, DUP);
    db()
      .prepare(
        "INSERT INTO album_permissions (album_id, kind, value) VALUES ('album-1', 'user', ?)"
      )
      .run(DUP);
    db()
      .prepare(
        "INSERT INTO sessions (token, id_user, created_at, expires_at) VALUES ('s-dup', ?, 1, 9999999999)"
      )
      .run(DUP);
    const consentBefore = db()
      .prepare(
        'SELECT created_at, version, source, withdrawn_at FROM face_consents WHERE user_id = ?'
      )
      .get(DUP);

    const r = await call();
    expect(r).toEqual({ status: 200, body: { outcome: 'transferred' } });

    const target = userRow(TARGET)!;
    expect(target).toMatchObject({
      name: 'Bea Martin',
      promo: 2019,
      formation: 'ICM',
      role: 'user',
      locale: 'en',
      photos_id: 'bbbbbbbb-0000-4000-8000-000000000001',
      photos_asset_id: 'asset-avatar',
      photos_asset_source: 'chosen',
    });
    expect(userRow(DUP)).toBeNull();
    expect(count('user_favorites', 'user_id = ?', TARGET)).toBe(2);
    expect(
      count('photo_access_permissions', 'owner_id = ? AND authorized_id = ?', TARGET, OTHER)
    ).toBe(1);
    expect(
      count('photo_access_permissions', 'owner_id = ? AND authorized_id = ?', OTHER, TARGET)
    ).toBe(1);
    expect(count('album_permissions', "kind = 'user' AND value = ?", TARGET)).toBe(1);
    expect(count('album_permissions', "kind = 'user' AND value = ?", DUP)).toBe(0);
    expect(count('sessions', 'id_user = ?', DUP)).toBe(0);

    // The enrolment and its consent moved TOGETHER, the consent unchanged.
    expect(
      db()
        .prepare(
          'SELECT created_at, version, source, withdrawn_at FROM face_consents WHERE user_id = ?'
        )
        .get(TARGET)
    ).toEqual(consentBefore);
    for (const table of FACE_TABLES) {
      expect(count(table, 'user_id = ?', DUP), table).toBe(0);
    }
    expect(count('face_references', 'user_id = ?', TARGET)).toBe(2);
    expect(count('face_negatives', 'user_id = ?', TARGET)).toBe(1);
    expect(count('face_reference_ledger', 'user_id = ?', TARGET)).toBe(1);
    expect(count('face_matches', 'user_id = ?', TARGET)).toBe(1);
    expect(count('face_reference_selection', 'user_id = ?', TARGET)).toBe(1);
    // No face row without its consent.
    for (const table of FACE_TABLES) {
      expect(
        count(
          table,
          'user_id NOT IN (SELECT user_id FROM face_consents WHERE withdrawn_at IS NULL)'
        ),
        table
      ).toBe(0);
    }
    // Re-sealed: the templates open for the target, and no longer for the duplicate.
    const refs = db()
      .prepare('SELECT sealed FROM face_references WHERE user_id = ? ORDER BY id')
      .all(TARGET) as Array<{ sealed: Uint8Array }>;
    expect(
      Array.from(sealing.unseal(faceKey, sealing.referenceContext(TARGET, MODEL), refs[0].sealed))
    ).toEqual(Array.from(embedding(1)));
    expect(() =>
      sealing.unseal(faceKey, sealing.referenceContext(DUP, MODEL), refs[0].sealed)
    ).toThrow();
    const neg = db().prepare('SELECT sealed FROM face_negatives WHERE user_id = ?').get(TARGET) as {
      sealed: Uint8Array;
    };
    expect(
      Array.from(sealing.unseal(faceKey, sealing.negativeContext(TARGET, MODEL), neg.sealed))
    ).toEqual(Array.from(embedding(9)));
    const led = db()
      .prepare('SELECT sealed FROM face_reference_ledger WHERE user_id = ?')
      .get(TARGET) as { sealed: Uint8Array };
    expect(
      Array.from(sealing.unseal(faceKey, sealing.referenceContext(TARGET, MODEL), led.sealed))
    ).toEqual(Array.from(embedding(5)));
    // Nothing journalled to Immich for the moved link.
    expect(count('face_erasures', '1 = 1')).toBe(0);
  });

  it('keeps the target`s own face data and erases the duplicate`s, journalled', async () => {
    addUser(DUP);
    addUser(TARGET, { locale: 'fr' });
    enrol(DUP, 'bbbbbbbb-0000-4000-8000-000000000001');
    enrol(TARGET, 'bbbbbbbb-0000-4000-8000-000000000002', 1_600_000_000_000);
    const r = await call();
    expect(r.body).toEqual({ outcome: 'transferred' });
    expect(userRow(TARGET)).toMatchObject({
      photos_id: 'bbbbbbbb-0000-4000-8000-000000000002',
      locale: 'fr',
    });
    expect(
      count('face_consents', 'user_id = ? AND created_at = ?', TARGET, 1_600_000_000_000)
    ).toBe(1);
    expect(count('face_consents', 'user_id = ?', TARGET)).toBe(1);
    expect(count('face_references', 'user_id = ?', TARGET)).toBe(2);
    for (const table of FACE_TABLES) {
      expect(count(table, 'user_id = ?', DUP), table).toBe(0);
    }
    expect(db().prepare('SELECT person_id, reason FROM face_erasures').all()).toEqual([
      { person_id: 'bbbbbbbb-0000-4000-8000-000000000001', reason: 'account_deletion' },
    ]);
  });

  it('drops a grant the target would hold to itself, and never carries a role', async () => {
    addUser(DUP, { role: 'mitviste' });
    addUser(TARGET);
    db()
      .prepare(
        'INSERT INTO photo_access_permissions (owner_id, authorized_id) VALUES (?, ?), (?, ?)'
      )
      .run(DUP, TARGET, TARGET, DUP);
    const r = await call();
    expect(r.body).toEqual({ outcome: 'transferred' });
    expect(count('photo_access_permissions', '1 = 1')).toBe(0);
    expect(userRow(TARGET)!.role).toBe('user');
    expect(logged.some((l) => l.includes('role is not carried') && l.includes('mitviste'))).toBe(
      true
    );
  });

  it('a replay after a success is `absent` and moves nothing twice', async () => {
    addUser(DUP);
    db().prepare("INSERT INTO user_favorites (user_id, asset_id) VALUES (?, 'fav-1')").run(DUP);
    expect((await call()).body).toEqual({ outcome: 'transferred' });
    db().prepare('DELETE FROM user_favorites WHERE user_id = ?').run(TARGET);
    expect(await call()).toEqual({ status: 200, body: { outcome: 'absent' } });
    expect(count('user_favorites', 'user_id = ?', TARGET)).toBe(0);
    expect(userRow(TARGET)).not.toBeNull();
  });

  it('a duplicate that never signed in here is `absent`, and creates no target', async () => {
    expect(await call()).toEqual({ status: 200, body: { outcome: 'absent' } });
    expect(userRow(TARGET)).toBeNull();
  });
});

describe('the erase-only mode', () => {
  it('erases the duplicate and moves nothing', async () => {
    addUser(DUP);
    enrol(DUP, 'bbbbbbbb-0000-4000-8000-000000000001');
    db().prepare("INSERT INTO user_favorites (user_id, asset_id) VALUES (?, 'fav-1')").run(DUP);
    const r = await call({ dup: DUP, jti: 'job-2', mode: 'erase' });
    expect(r).toEqual({ status: 200, body: { outcome: 'erased' } });
    expect(userRow(DUP)).toBeNull();
    expect(userRow(TARGET)).toBeNull();
    expect(count('user_favorites', '1 = 1')).toBe(0);
    for (const table of FACE_TABLES) {
      expect(count(table, '1 = 1'), table).toBe(0);
    }
    expect(count('face_erasures', '1 = 1')).toBe(1);
    expect((await call({ dup: DUP, jti: 'job-2', mode: 'erase' })).body).toEqual({
      outcome: 'absent',
    });
  });

  it('an erase token naming a target is refused (Canari blanks it with the person)', async () => {
    addUser(DUP);
    const r = await call({ dup: DUP, target: TARGET, jti: 'job-5', mode: 'erase' });
    expect(r).toEqual({ status: 401, body: { outcome: 'invalid' } });
    expect(userRow(DUP)).not.toBeNull();
  });

  it('an unknown mode is refused', async () => {
    addUser(DUP);
    const r = await call({ dup: DUP, target: TARGET, jti: 'job-3', mode: 'merge-all' });
    expect(r).toEqual({ status: 401, body: { outcome: 'invalid' } });
    expect(userRow(DUP)).not.toBeNull();
  });
});

describe('the refusals on this site`s state write nothing', () => {
  it('a duplicate administrator is refused (the last-admin guard is never what decides)', async () => {
    addUser(DUP, { role: 'admin' });
    addUser(OTHER, { role: 'admin' });
    const r = await call();
    expect(r).toEqual({ status: 409, body: { code: 'ALUMNI_MERGE_DUPLICATE_IS_ADMIN' } });
    expect(userRow(DUP)).not.toBeNull();
    expect(userRow(TARGET)).toBeNull();
  });

  it('one subject on both sides is refused', async () => {
    addUser(DUP);
    const r = await call({ dup: DUP, target: DUP, jti: 'job-4' });
    expect(r).toEqual({ status: 409, body: { code: 'ALUMNI_MERGE_SAME_SUBJECT' } });
    expect(userRow(DUP)).not.toBeNull();
  });

  it('a template that does not open is refused, and the transaction rolls back', async () => {
    addUser(DUP);
    enrol(DUP, 'bbbbbbbb-0000-4000-8000-000000000001');
    db()
      .prepare('UPDATE face_negatives SET sealed = ? WHERE user_id = ?')
      .run(new Uint8Array(64), DUP);
    const r = await call();
    expect(r).toEqual({ status: 409, body: { code: 'ALUMNI_MERGE_FACE_UNREADABLE' } });
    expect(userRow(TARGET)).toBeNull();
    expect(count('face_references', 'user_id = ?', DUP)).toBe(2);
  });

  it('no face key: 503, retried, nothing written', async () => {
    addUser(DUP);
    enrol(DUP, 'bbbbbbbb-0000-4000-8000-000000000001');
    const saved = envModule.env.FACE_STORE_KEY;
    delete envModule.env.FACE_STORE_KEY;
    try {
      const r = await call();
      expect(r).toEqual({ status: 503, body: { code: 'FACE_STORE_KEY_UNAVAILABLE' } });
    } finally {
      envModule.env.FACE_STORE_KEY = saved;
    }
    expect(userRow(DUP)).not.toBeNull();
    expect(userRow(TARGET)).toBeNull();
  });
});

describe('the token', () => {
  beforeEach(() => addUser(DUP));
  const untouched = () => expect(userRow(DUP)).not.toBeNull();

  it('no Authorization header is refused', async () => {
    const r = await endpoint.handleAlumniMergeCall({ authorization: null, keys });
    expect(r.status).toBe(401);
    untouched();
  });

  it('a handoff token (another typ) is refused', async () => {
    expect((await call(undefined, { typ: 'canari-handoff+jwt' })).status).toBe(401);
    untouched();
  });

  it('another audience, another issuer, an expired token, a too-long one are refused', async () => {
    const now = Math.floor(Date.now() / 1000);
    expect((await call(undefined, { aud: 'sky' })).body).toEqual({ outcome: 'wrong_audience' });
    expect((await call(undefined, { iss: 'https://evil.example' })).body).toEqual({
      outcome: 'wrong_issuer',
    });
    expect((await call(undefined, { iat: now - 600, exp: now - 540 })).body).toEqual({
      outcome: 'expired',
    });
    expect((await call(undefined, { iat: now, exp: now + 3600 })).body).toEqual({
      outcome: 'too_long',
    });
    untouched();
  });

  it('a token signed by another key is refused', async () => {
    const other = await generateKeyPair('ES256');
    const forged = await new SignJWT({ dup: DUP, target: TARGET, jti: 'x' })
      .setProtectedHeader({ alg: 'ES256', typ: 'canari-merge+jwt', kid: 'k1' })
      .setIssuer(ISSUER)
      .setAudience('migallery')
      .setIssuedAt()
      .setExpirationTime('60s')
      .sign(other.privateKey);
    const r = await endpoint.handleAlumniMergeCall({ authorization: `Bearer ${forged}`, keys });
    expect(r).toEqual({ status: 401, body: { outcome: 'invalid' } });
    untouched();
  });

  it('a claim missing is refused', async () => {
    expect((await call({ dup: DUP, jti: 'x' })).status).toBe(401);
    untouched();
  });

  it('keys that cannot be fetched answer 503', async () => {
    const r = await endpoint.handleAlumniMergeCall({
      authorization: `Bearer ${await token({ dup: DUP, target: TARGET, jti: 'x' })}`,
      keys: async () => {
        throw new Error('ECONNREFUSED');
      },
    });
    expect(r).toEqual({ status: 503, body: { outcome: 'keys_unavailable' } });
    untouched();
  });

  it('a deployment that trusts no Canari issuer answers 503 not_configured', async () => {
    const saved = envModule.env.CANARI_HANDOFF_ISSUER;
    delete envModule.env.CANARI_HANDOFF_ISSUER;
    try {
      const r = await endpoint.handleAlumniMergeCall({
        authorization: `Bearer ${await token({ dup: DUP, target: TARGET, jti: 'x' })}`,
      });
      expect(r).toEqual({ status: 503, body: { outcome: 'not_configured' } });
    } finally {
      envModule.env.CANARI_HANDOFF_ISSUER = saved;
    }
    untouched();
  });
});

describe('what the logs carry', () => {
  it('no full subject, no name, no token - prefixes and counts only', async () => {
    addUser(DUP);
    enrol(DUP, 'bbbbbbbb-0000-4000-8000-000000000001');
    const t = await token({ dup: DUP, target: TARGET, jti: 'job-log' });
    await endpoint.handleAlumniMergeCall({ authorization: `Bearer ${t}`, keys });
    const all = logged.join('\n');
    expect(all).toContain(DUP.slice(0, 8));
    expect(all).not.toContain(DUP);
    expect(all).not.toContain(TARGET);
    expect(all).not.toContain('Martin');
    expect(all).not.toContain(t);
  });
});

describe('the schema walk', () => {
  it('every table that names a user is in the merge`s allowlist, and nothing else is', () => {
    const tables = (
      db()
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
        .all() as Array<{ name: string }>
    ).map((t) => t.name);
    const USER_COLUMN = /^(id_user|user_id|owner_id|authorized_id|impersonated_id_user|sub|actor)$/;
    const naming = tables.filter((t) =>
      (db().prepare(`PRAGMA table_info(${t})`).all() as Array<{ name: string }>).some((c) =>
        USER_COLUMN.test(c.name)
      )
    );
    // album_permissions names a user in `value` when kind = 'user': listed by hand, as it is here.
    const expected = [...naming, 'album_permissions'].sort();
    expect(Object.keys(merge.ALUMNI_MERGE_TABLES).sort()).toEqual(expected);
  });
});
