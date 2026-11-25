/**
 * Admin impersonation is a POST (docs/wiki/authentication.md, "Impersonation"), against the test
 * server: opening `/admin/login-as?u=<id>` only shows a confirmation, the write is
 * `POST /api/change-user`, and that write is refused cross-site and to a session a Canari handoff
 * opened. Every assertion reads the session row itself, so "nothing was written" is a fact, not
 * an inference from a status code.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { STEP_UP_HEADER } from '#lib/step-up.ts';
import { TEST_CONFIG, loginAsTestAdmin, openTestDatabase, type TestDatabase } from './test-helpers';

const BASE = TEST_CONFIG.API_BASE_URL;
const TARGET = 'impersonation-test-target';

let cookie: string;
let token: string;
let db: TestDatabase;

/** The impersonation recorded on this suite's own session row. */
function impersonated(): string | null {
  const row = db
    .prepare('SELECT impersonated_id_user AS id FROM sessions WHERE token = ?')
    .get(token) as { id: string | null } | null;
  return row?.id ?? null;
}

function changeUser(userId: string | null, headers: Record<string, string> = {}) {
  return fetch(`${BASE}/api/change-user`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: BASE, ...headers },
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

  it('asks a session a Canari handoff opened for a MiConnect sign-in first', async () => {
    db.prepare('UPDATE sessions SET via_handoff = 1 WHERE token = ?').run(token);
    const res = await changeUser(TARGET);
    expect(res.status).toBe(403);
    expect(res.headers.get(STEP_UP_HEADER)).toBe('1');
    expect(impersonated()).toBeNull();
  });
});
