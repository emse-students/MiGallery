/**
 * Authentik is the source of truth; the `users` row is a COPY (`src/lib/auth.ts`).
 *
 * What this pins is the half that used to be missing. A login always wrote the claims it received,
 * so a CHANGE propagated - but the update skipped any claim that was absent, so a REMOVAL never
 * did: a `promo` the school had taken off an account stayed in MiGallery for ever, and `promo` is
 * an album-access key. The failure is silent by construction, which is exactly why it needs a test
 * rather than a review: nothing observable happens until someone opens an album they should no
 * longer see.
 *
 * These are pure DB assertions against a throwaway SQLite file - no server, no network. The two
 * fetches in the OIDC flow are upstream of the function under test and are what make writing a
 * NULL sound: it only runs once the IdP has ANSWERED.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let auth: typeof import('$lib/auth');
let users: typeof import('$lib/db/users');
let database: typeof import('$lib/db/database');
let dbDir: string;

const SUB = 'sso-mirror-test-subject';

beforeAll(async () => {
  // DB_PATH is read once at module load, so the env has to be set BEFORE the first import -
  // which is why these are dynamic. A temp file rather than ':memory:' because ensureSchema and
  // every query go through the same better-sqlite3 handle either way, and a file is inspectable
  // when one of these fails.
  dbDir = mkdtempSync(join(tmpdir(), 'migallery-sso-'));
  process.env.DATABASE_PATH = join(dbDir, 'sso-mirror.db');

  auth = await import('$lib/auth');
  users = await import('$lib/db/users');
  database = await import('$lib/db/database');
});

afterAll(() => {
  database.resetDatabase();
  rmSync(dbDir, { recursive: true, force: true });
});

/** One login, with whatever claims Authentik chose to send this time. */
function login(claims: Record<string, unknown>) {
  return auth.handleUserInDatabase({ sub: SUB, ...claims }, {});
}

describe('the local row mirrors Authentik', () => {
  it('creates the row from the claims on a first login', () => {
    login({
      name: 'Amelie Durand',
      given_name: 'Amelie',
      family_name: 'Durand',
      promo: '2024',
      formation: 'InfoCom',
    });

    const row = users.getUserByCasId(SUB);
    expect(row?.first_name).toBe('Amelie');
    expect(row?.last_name).toBe('Durand');
    expect(row?.promo).toBe(2024);
    expect(row?.formation).toBe('InfoCom');
  });

  it('overwrites a value Authentik changed', () => {
    login({
      name: 'Amelie Durand',
      given_name: 'Amelie',
      family_name: 'Durand',
      promo: '2025',
      formation: 'DevOps',
    });

    const row = users.getUserByCasId(SUB);
    expect(row?.promo).toBe(2025);
    expect(row?.formation).toBe('DevOps');
  });

  it('clears a value Authentik stopped sending', () => {
    // The regression this file exists for. Answering with no `promo` is what the IdP does for
    // school staff, and for anyone whose promo has been removed - the two are indistinguishable
    // here, and both mean the same thing: MiGallery must not keep one.
    login({ name: 'Amelie Durand', given_name: 'Amelie', family_name: 'Durand' });

    const row = users.getUserByCasId(SUB);
    expect(row?.promo).toBeNull();
    expect(row?.formation).toBeNull();
    expect(row?.first_name).toBe('Amelie');
  });

  it('leaves MiGallery-owned fields alone', () => {
    // `role` is the app's own - granted in /admin, never claimed by the IdP. A login that reset
    // it would silently demote every mitviste, so the payload must not name the column at all.
    users.updateUser({ id_user: SUB, role: 'mitviste' });

    login({ name: 'Amelie Durand', given_name: 'Amelie', family_name: 'Durand', promo: '2025' });

    expect(users.getUserByCasId(SUB)?.role).toBe('mitviste');
  });
});
