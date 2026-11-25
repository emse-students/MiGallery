/**
 * Admin impersonation is a POST (docs/wiki/authentication.md, "Impersonation"), against the test
 * server: opening `/admin/login-as?u=<id>` only shows a confirmation, the write is
 * `POST /api/change-user`, a session-only action taken from this site's own pages and judged on
 * the session's REAL account, refused to a session a Canari handoff opened. Stopping is the same
 * POST with `userId: null`, offered by a banner on every page; there is no GET for it either. Every
 * assertion reads the session row itself, so "nothing was written" is a fact, not an inference
 * from a status code.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { STEP_UP_HEADER } from '#lib/step-up.ts';
import { TEST_CONFIG, loginAsTestAdmin, openTestDatabase, type TestDatabase } from './test-helpers';

const BASE = TEST_CONFIG.API_BASE_URL;
/** The `Origin` the server's own pages send. */
const SELF = TEST_CONFIG.SELF_ORIGIN;
const TARGET = 'impersonation-test-target';

let cookie: string;
let token: string;
let db: TestDatabase;
/** Accounts, sessions and keys this suite created, deleted in `afterAll`. */
const created = { users: [] as string[], tokens: [] as string[], keys: [] as number[] };

/** A fresh account of the given role with a live session row, written directly. */
function accountWithSession(role: 'admin' | 'user'): { id: string; token: string; cookie: string } {
  const id = `impersonation-test-${role}-${randomUUID()}`;
  const sessionToken = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  db.prepare('INSERT INTO users (id_user, name, role) VALUES (?, ?, ?)').run(id, id, role);
  db.prepare(
    'INSERT INTO sessions (token, id_user, impersonated_id_user, created_at, expires_at, via_handoff) VALUES (?, ?, NULL, ?, ?, 0)'
  ).run(sessionToken, id, now, now + 3600);
  created.users.push(id);
  created.tokens.push(sessionToken);
  return { id, token: sessionToken, cookie: `migallery_session=${sessionToken}` };
}

/** The impersonation recorded on a session row (this suite's own by default). */
function impersonated(on = token): string | null {
  const row = db
    .prepare('SELECT impersonated_id_user AS id FROM sessions WHERE token = ?')
    .get(on) as { id: string | null } | null;
  return row?.id ?? null;
}

/** Put a session in the state under test directly, so only the request under test writes. */
function setSession(on: string, impersonating: string | null, viaHandoff = false) {
  db.prepare('UPDATE sessions SET impersonated_id_user = ?, via_handoff = ? WHERE token = ?').run(
    impersonating,
    viaHandoff ? 1 : 0,
    on
  );
}

/** The request this site's own page sends; `headers` override or (set to '') drop a header. */
function changeUser(userId: string | null, headers: Record<string, string> = {}) {
  const all: Record<string, string> = {
    'Content-Type': 'application/json',
    Cookie: cookie,
    Origin: SELF,
    ...headers,
  };
  for (const k of Object.keys(all)) if (all[k] === '') delete all[k];
  return fetch(`${BASE}/api/change-user`, {
    method: 'POST',
    redirect: 'manual',
    headers: all,
    body: JSON.stringify({ userId }),
  });
}

beforeAll(async () => {
  cookie = await loginAsTestAdmin();
  token = cookie.slice(cookie.indexOf('=') + 1);
  const opened = await openTestDatabase();
  if (!opened) throw new Error('the test database does not exist');
  db = opened;
  db.prepare('INSERT OR IGNORE INTO users (id_user, name) VALUES (?, ?)').run(
    TARGET,
    'Impersonation Target'
  );
});

afterEach(() => {
  db.prepare(
    'UPDATE sessions SET impersonated_id_user = NULL, via_handoff = 0 WHERE token = ?'
  ).run(token);
});

afterAll(() => {
  if (!db) return; // beforeAll already failed, and said why
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  for (const t of created.tokens) db.prepare('DELETE FROM sessions WHERE token = ?').run(t);
  for (const u of created.users) db.prepare('DELETE FROM users WHERE id_user = ?').run(u);
  for (const k of created.keys) db.prepare('DELETE FROM api_keys WHERE id = ?').run(k);
  db.prepare('DELETE FROM users WHERE id_user = ?').run(TARGET);
  db.close(true);
});

describe('GET /admin/login-as', () => {
  it('shows a confirmation naming the account, and writes nothing', async () => {
    const res = await fetch(`${BASE}/admin/login-as?u=${TARGET}`, {
      redirect: 'manual',
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain(TARGET);
    expect(impersonated()).toBeNull();
  });

  it('answers 404 for an unknown account, and writes nothing', async () => {
    const res = await fetch(`${BASE}/admin/login-as?u=no-such-user`, {
      redirect: 'manual',
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(404);
    expect(impersonated()).toBeNull();
  });
});

describe('/api/change-user', () => {
  it('has no GET: a link cannot reach the write', async () => {
    const res = await fetch(`${BASE}/api/change-user?userId=${TARGET}`, {
      redirect: 'manual',
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(405);
    expect(impersonated()).toBeNull();
  });

  it('refuses a cross-site POST before the handler', async () => {
    const res = await changeUser(TARGET, { Origin: 'https://evil.example' });
    expect(res.status).toBe(403);
    expect(impersonated()).toBeNull();
  });

  it('starts an impersonation on a same-origin POST, and stops it with userId null', async () => {
    expect((await changeUser(TARGET)).status).toBe(200);
    expect(impersonated()).toBe(TARGET);
    expect((await changeUser(null)).status).toBe(200);
    expect(impersonated()).toBeNull();
  });

  it('refuses a request with no Origin, and one not declared JSON', async () => {
    expect((await changeUser(TARGET, { Origin: '' })).status).toBe(403);
    expect((await changeUser(TARGET, { 'Content-Type': 'text/plain' })).status).toBe(403);
    expect(impersonated()).toBeNull();
  });

  it('refuses a plain non-admin session', async () => {
    const member = accountWithSession('user');
    expect((await changeUser(TARGET, { Cookie: member.cookie })).status).toBe(403);
    expect(impersonated(member.token)).toBeNull();
  });

  it('refuses any API key, even an admin one beside a non-admin session', async () => {
    const res = await fetch(`${BASE}/api/admin/api-keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: SELF },
      body: JSON.stringify({ label: 'impersonation-test', scopes: ['admin'] }),
    });
    const key = (await res.json()) as { id: number; rawKey: string };
    created.keys.push(key.id);
    const member = accountWithSession('user');
    const refused = await changeUser(TARGET, { Cookie: member.cookie, 'x-api-key': key.rawKey });
    expect(refused.status).toBe(403);
    expect(impersonated(member.token)).toBeNull();
  });

  it('refuses a second start while impersonating: switching goes through a stop', async () => {
    setSession(token, TARGET);
    expect((await changeUser(TARGET)).status).toBe(409);
    expect(impersonated()).toBe(TARGET);
  });

  it('asks a session a Canari handoff opened for a MiConnect sign-in first', async () => {
    db.prepare('UPDATE sessions SET via_handoff = 1 WHERE token = ?').run(token);
    const res = await changeUser(TARGET);
    expect(res.status).toBe(403);
    expect(res.headers.get(STEP_UP_HEADER)).toBe('1');
    expect(impersonated()).toBeNull();
  });
});

describe('stopping an impersonation', () => {
  it('is offered by a banner on every page while impersonating, and only then', async () => {
    const page = () =>
      fetch(`${BASE}/albums`, { headers: { Cookie: cookie } }).then((r) => r.text());
    expect(await page()).not.toContain('impersonation-banner');
    setSession(token, TARGET);
    expect(await page()).toContain('impersonation-banner');
  });

  it('has no GET: the old /admin/stop-impersonating URL writes nothing', async () => {
    setSession(token, TARGET);
    const res = await fetch(`${BASE}/admin/stop-impersonating`, {
      redirect: 'manual',
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(404);
    expect(impersonated()).toBe(TARGET);
  });

  it('stops on a same-origin POST, judged on the real admin behind the impersonated account', async () => {
    setSession(token, TARGET);
    expect((await changeUser(null)).status).toBe(200);
    expect(impersonated()).toBeNull();
  });

  it('refuses a cross-site stop', async () => {
    setSession(token, TARGET);
    expect((await changeUser(null, { Origin: 'https://evil.example' })).status).toBe(403);
    expect(impersonated()).toBe(TARGET);
  });

  it('does not trap a handoff session: the step-up or logout each end it', async () => {
    // A marked session that impersonates (one started before change-user lost its exemption).
    const other = await loginAsTestAdmin();
    const otherToken = other.slice(other.indexOf('=') + 1);
    setSession(otherToken, TARGET, true);
    const headers = { 'Content-Type': 'application/json', Cookie: other, Origin: SELF };

    // The stop is a change, so it asks for the MiConnect sign-in, whose callback replaces the
    // session with an unmarked one that impersonates nobody (api/auth/callback).
    const stop = await fetch(`${BASE}/api/change-user`, {
      method: 'POST',
      redirect: 'manual',
      headers,
      body: JSON.stringify({ userId: null }),
    });
    expect(stop.status).toBe(403);
    expect(stop.headers.get(STEP_UP_HEADER)).toBe('1');

    // Logout stays exempt from the step-up, and deleting the row ends the impersonation with it.
    const out = await fetch(`${BASE}/api/auth/logout`, {
      method: 'POST',
      redirect: 'manual',
      headers,
    });
    expect(out.status).toBe(302);
    expect(db.prepare('SELECT 1 FROM sessions WHERE token = ?').get(otherToken)).toBeNull();
  });
});

describe('an impersonation outlives no admin right', () => {
  it('ends when the real account is demoted: the session falls back to that account', async () => {
    const admin = accountWithSession('admin');
    setSession(admin.token, TARGET);
    const me = async () => {
      const res = await fetch(`${BASE}/api/users/me`, { headers: { Cookie: admin.cookie } });
      return ((await res.json()) as { user: { id_user: string } }).user.id_user;
    };
    expect(await me()).toBe(TARGET);

    db.prepare("UPDATE users SET role = 'user' WHERE id_user = ?").run(admin.id);
    expect(await me()).toBe(admin.id);
    expect(impersonated(admin.token)).toBeNull();
  });
});
