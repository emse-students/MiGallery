/**
 * The Canari sign-in handoff's redemption (`#lib/server/handoff/redeem.ts`), against a throwaway
 * SQLite file and Canari's vectors (`tests/fixtures/handoff-token.cases.json`, COPIED from Canari's
 * `libs/contracts/` and regenerated only there). Pinned: every vector answers what Canari says, the
 * interstitial comes before anything is written - with no session and with another user's - a
 * token is redeemed once (the ledger INSERT decides), a wrong Origin is refused, an unknown `sub`
 * goes through MiConnect, the session opened is MARKED, and the token is in no log line.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createLocalJWKSet, createRemoteJWKSet, type JSONWebKeySet } from 'jose';
import { removeTempDir } from './test-helpers';

const vectors = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'handoff-token.cases.json'), 'utf8')
) as {
  issuer: string;
  audience: string;
  jwks: JSONWebKeySet;
  cases: Array<{ name: string; token: string; now: number; expect: string; sub?: string }>;
  replay: { token: string; now: number; expect: string[] };
  keysUnavailable: { token: string; now: number; jwksStatus: number; expect: string };
};

vi.mock('#lib/server/env.ts', () => ({
  env: { CANARI_HANDOFF_ISSUER: 'https://canari.example', AVATAR_SIGNING_KEY: 'test-avatar-key' },
}));

const ORIGIN = 'https://gallery.mitv.fr';
const valid = vectors.cases.find((c) => c.name === 'valid')!;
const SUB = valid.sub!;

let redeem: typeof import('#lib/server/handoff/redeem.ts');
let verify: typeof import('#lib/server/handoff/handoff-verify.ts');
let sessions: typeof import('#lib/db/sessions.ts');
let database: typeof import('#lib/db/database.ts');
let dbDir: string;
const logged: string[] = [];

beforeAll(async () => {
  dbDir = mkdtempSync(join(tmpdir(), 'migallery-handoff-'));
  process.env.DATABASE_PATH = join(dbDir, 'handoff.db');
  // The logger reads its level once, at load: every line is captured here.
  process.env.LOG_LEVEL = 'debug';
  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logged.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    });
  }
  database = await import('#lib/db/database.ts');
  sessions = await import('#lib/db/sessions.ts');
  verify = await import('#lib/server/handoff/handoff-verify.ts');
  redeem = await import('#lib/server/handoff/redeem.ts');
});

afterAll(() => {
  vi.restoreAllMocks();
  delete process.env.LOG_LEVEL;
  database.resetDatabase();
  removeTempDir(dbDir);
});

const db = () => database.getDatabase();
const keys = () => createLocalJWKSet(vectors.jwks);

function addUser(id: string, first: string, last: string) {
  db()
    .prepare(
      "INSERT OR REPLACE INTO users (id_user, name, first_name, last_name, role, photos_asset_id) VALUES (?, ?, ?, ?, 'user', ?)"
    )
    .run(id, `${first} ${last}`, first, last, `asset-${id}`);
}

beforeEach(() => {
  db().exec('DELETE FROM handoff_redemptions; DELETE FROM sessions; DELETE FROM users;');
  addUser(SUB, 'Bea', 'Martin');
  addUser('someone-else', 'Alex', 'Durand');
});

const post = (
  token: string,
  opts: { confirm?: boolean; origin?: string | null; current?: unknown; now?: number } = {}
) =>
  redeem.redeemHandoff({
    origin: opts.origin === undefined ? ORIGIN : opts.origin,
    ownOrigin: ORIGIN,
    contentType: 'application/json',
    body: opts.confirm === undefined ? { token } : { token, confirm: opts.confirm },
    current: (opts.current ?? null) as never,
    now: new Date((opts.now ?? valid.now) * 1000),
    keys: keys(),
  });

const ledger = () =>
  (db().prepare('SELECT COUNT(*) AS n FROM handoff_redemptions').get() as { n: number }).n;
const sessionRows = () =>
  db().prepare('SELECT id_user, via_handoff FROM sessions ORDER BY created_at').all() as Array<{
    id_user: string;
    via_handoff: number;
  }>;

describe('the vectors, through the vendored verifier with MiGallery`s redirect validator', () => {
  for (const c of vectors.cases) {
    it(`${c.name} -> ${c.expect}`, async () => {
      const r = await verify.verifyHandoff(c.token, {
        keys: keys(),
        issuer: vectors.issuer,
        audience: redeem.HANDOFF_AUDIENCE,
        redirectAllows: redeem.handoffDestAllowed,
        currentDate: new Date(c.now * 1000),
      });
      expect(r.outcome).toBe(c.expect);
    });
  }

  it('the audience is this site`s own constant, the one the vectors name', () => {
    expect(vectors.audience).toBe(redeem.HANDOFF_AUDIENCE);
  });

  it('the home page is a valid dest even though safeRedirectTarget remembers nothing for it', () => {
    expect(redeem.handoffDestAllowed('/')).toBe(true);
    expect(redeem.handoffDestAllowed('/mes-photos')).toBe(true);
    expect(redeem.handoffDestAllowed('//evil.example/x')).toBe(false);
    expect(redeem.handoffDestAllowed('/api/auth/login')).toBe(false);
  });
});

describe('the redemption', () => {
  it('shows the interstitial with no session, writing nothing; the click redeems and MARKS the session', async () => {
    const first = await post(valid.token);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({
      outcome: 'confirm',
      current: null,
      next: {
        name: 'Bea Martin',
        photo: expect.stringContaining(`/api/users/${SUB}/avatar?v=asset-${SUB}&sig=`),
      },
    });
    const { computeAvatarSignature } = await import('#lib/server/avatar-signature.ts');
    const photo = (first.body.next as { photo: string }).photo;
    expect(new URL(photo, ORIGIN).searchParams.get('sig')).toBe(
      computeAvatarSignature('test-avatar-key', SUB, null)
    );
    expect(first.session).toBeUndefined();
    expect(ledger()).toBe(0);
    expect(sessionRows()).toEqual([]);

    const second = await post(valid.token, { confirm: true });
    expect(second.body).toEqual({ outcome: 'ok', dest: '/mes-photos' });
    expect(second.session).toBeDefined();
    expect(ledger()).toBe(1);
    expect(sessionRows()).toEqual([{ id_user: SUB, via_handoff: 1 }]);
    expect(sessions.resolveSession(second.session!.token)?.viaHandoff).toBe(true);
  });

  it('is redeemed once: the replay sequence answers ok, then replayed', async () => {
    const answers: string[] = [];
    for (let i = 0; i < 2; i++) {
      const r = await post(vectors.replay.token, { confirm: true, now: vectors.replay.now });
      answers.push(String(r.body.outcome));
    }
    expect(answers).toEqual(vectors.replay.expect);
    expect(sessionRows()).toHaveLength(1);
  });

  it('refuses a wrong Origin, and no Origin, before reading the token', async () => {
    for (const origin of ['https://evil.example', null]) {
      const r = await post(valid.token, { confirm: true, origin });
      expect([r.status, r.body]).toEqual([403, { outcome: 'bad_origin' }]);
    }
    expect(ledger()).toBe(0);
  });

  it('refuses a body that is not JSON or carries no token', async () => {
    const notJson = await redeem.redeemHandoff({
      origin: ORIGIN,
      ownOrigin: ORIGIN,
      contentType: 'text/plain',
      body: undefined,
      current: null,
      keys: keys(),
    });
    expect(notJson.status).toBe(415);
    const noToken = await redeem.redeemHandoff({
      origin: ORIGIN,
      ownOrigin: ORIGIN,
      contentType: 'application/json',
      body: { token: 42 },
      current: null,
      keys: keys(),
    });
    expect([noToken.status, noToken.body]).toEqual([400, { outcome: 'invalid' }]);
  });

  it('names the live session of another user, and replaces it on the click', async () => {
    const other = sessions.createSession('someone-else');
    const current = sessions.resolveSession(other.token);
    const asked = await post(valid.token, { current });
    expect(asked.body).toMatchObject({ outcome: 'confirm', current: 'Alex Durand' });
    expect(sessionRows()).toEqual([{ id_user: 'someone-else', via_handoff: 0 }]);

    const done = await post(valid.token, { confirm: true, current });
    expect(done.body.outcome).toBe('ok');
    expect(sessionRows()).toEqual([{ id_user: SUB, via_handoff: 1 }]);
  });

  it('skips the interstitial for the user already signed in here, and keeps their session unmarked', async () => {
    const mine = sessions.createSession(SUB);
    const r = await post(valid.token, { current: sessions.resolveSession(mine.token) });
    expect(r.body).toEqual({ outcome: 'ok', dest: '/mes-photos' });
    expect(r.session).toBeUndefined();
    expect(sessionRows()).toEqual([{ id_user: SUB, via_handoff: 0 }]);
    expect(ledger()).toBe(1);
  });

  it('sends a sub it has never seen through MiConnect, with the dest', async () => {
    db().prepare('DELETE FROM users WHERE id_user = ?').run(SUB);
    const r = await post(valid.token, { confirm: true });
    expect(r.body).toEqual({ outcome: 'unknown_user', dest: '/mes-photos' });
    expect(sessionRows()).toEqual([]);
  });

  it('answers 503 keys_unavailable, at error, when Canari`s keys cannot be fetched (the vector)', async () => {
    const ku = vectors.keysUnavailable;
    const server = createServer((_req, res) => {
      res.statusCode = ku.jwksStatus;
      res.end('down');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address() as AddressInfo;
    logged.length = 0;
    try {
      const r = await redeem.redeemHandoff({
        origin: ORIGIN,
        ownOrigin: ORIGIN,
        contentType: 'application/json',
        body: { token: ku.token, confirm: true },
        current: null,
        now: new Date(ku.now * 1000),
        keys: createRemoteJWKSet(new URL(`http://127.0.0.1:${port}/jwks`)),
      });
      expect([r.status, r.body]).toEqual([503, { outcome: ku.expect }]);
    } finally {
      server.close();
    }
    expect(logged.some((l) => l.includes(`[HANDOFF] refused class=${ku.expect}`))).toBe(true);
    expect(ledger()).toBe(0);
  });

  it('spends no token when the session cannot be written: the ledger row rolls back with it', async () => {
    db().exec(
      'DROP TABLE IF EXISTS sessions_backup; ALTER TABLE sessions RENAME TO sessions_backup;'
    );
    try {
      await expect(post(valid.token, { confirm: true })).rejects.toThrow();
      expect(ledger()).toBe(0);
    } finally {
      db().exec('ALTER TABLE sessions_backup RENAME TO sessions;');
    }
    const again = await post(valid.token, { confirm: true });
    expect(again.body.outcome).toBe('ok');
  });

  it('refuses an expired token, also after the interstitial', async () => {
    const expired = vectors.cases.find((c) => c.expect === 'expired')!;
    const r = await post(expired.token, { confirm: true, now: expired.now });
    expect([r.status, r.body]).toEqual([400, { outcome: 'expired' }]);
  });

  it('purges, by proof, the ledger rows whose token can no longer verify', async () => {
    const now = valid.now;
    db()
      .prepare('INSERT INTO handoff_redemptions (jti, sub, exp, redeemed_at) VALUES (?, ?, ?, ?)')
      .run('dead', SUB, now - 31, now - 90);
    db()
      .prepare('INSERT INTO handoff_redemptions (jti, sub, exp, redeemed_at) VALUES (?, ?, ?, ?)')
      .run('alive', SUB, now - 29, now - 80);
    await post(valid.token, { confirm: true });
    const jtis = (db().prepare('SELECT jti FROM handoff_redemptions').all() as { jti: string }[])
      .map((r) => r.jti)
      .sort();
    expect(jtis).toEqual(['alive', 'vector-valid']);
  });

  it('never writes the token into a log line', async () => {
    logged.length = 0;
    await post(valid.token);
    await post(valid.token, { confirm: true });
    await post(valid.token, { confirm: true });
    await post(valid.token, { confirm: true, origin: 'https://evil.example' });
    const [, , signature] = valid.token.split('.');
    expect(logged.some((l) => l.includes('[HANDOFF] redeemed'))).toBe(true);
    expect(logged.some((l) => l.includes('[HANDOFF] refused class=replayed'))).toBe(true);
    for (const line of logged) {
      expect(line).not.toContain(valid.token);
      expect(line).not.toContain(signature);
    }
  });
});
