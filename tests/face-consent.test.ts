/**
 * The face consent record (src/lib/server/face-consent.ts), against a throwaway SQLite file.
 *
 * What it pins: links that predate the table get ONE `legacy` row each (and only once, however
 * often the schema is ensured); a new link records its source and the terms version; a withdrawal
 * closes the row without deleting it; an account deletion takes it by cascade.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeTempDir } from './test-helpers';

vi.mock('#lib/server/env.ts', () => ({ env: { IMMICH_BASE_URL: '', IMMICH_API_KEY: '' } }));

let consent: typeof import('#lib/server/face-consent.ts');
let erasure: typeof import('#lib/server/face-erasure.ts');
let database: typeof import('#lib/db/database.ts');
let legal: typeof import('#lib/legal.ts');
let dbDir: string;

const PERSON = 'dddddddd-0000-4000-8000-000000000001';

function addUser(id: string, photosId: string | null) {
  database
    .getDatabase()
    .prepare('INSERT INTO users (id_user, name, photos_id) VALUES (?, ?, ?)')
    .run(id, id, photosId);
}

function rows() {
  return database
    .getDatabase()
    .prepare('SELECT user_id, version, source, withdrawn_at FROM face_consents ORDER BY id')
    .all() as Array<Record<string, unknown>>;
}

beforeAll(async () => {
  dbDir = mkdtempSync(join(tmpdir(), 'migallery-face-consent-'));
  process.env.DATABASE_PATH = join(dbDir, 'face-consent.db');
  database = await import('#lib/db/database.ts');
  consent = await import('#lib/server/face-consent.ts');
  erasure = await import('#lib/server/face-erasure.ts');
  legal = await import('#lib/legal.ts');
  vi.stubGlobal('fetch', async () => new Response('down', { status: 503 }));
});

afterAll(() => {
  vi.unstubAllGlobals();
  database.resetDatabase();
  removeTempDir(dbDir);
});

beforeEach(() => {
  database
    .getDatabase()
    .exec('DELETE FROM face_erasures; DELETE FROM face_consents; DELETE FROM users;');
});

describe('the legacy backfill', () => {
  it('gives every linked member without a record one legacy row, once', () => {
    addUser('linked', PERSON);
    addUser('unlinked', null);
    const db = database.getDatabase();

    expect(consent.backfillLegacyConsents(db)).toBe(1);
    expect(consent.backfillLegacyConsents(db)).toBe(0);
    // ensureSchema runs at every start and carries the backfill: still one row.
    database.ensureSchema(db as never);

    expect(rows()).toEqual([
      {
        user_id: 'linked',
        version: legal.LEGACY_CONSENT_VERSION,
        source: 'legacy',
        withdrawn_at: null,
      },
    ]);
  });

  it('skips a member who already holds a record, withdrawn or not', () => {
    addUser('linked', PERSON);
    const db = database.getDatabase();
    consent.recordFaceConsent(db, 'linked', 'selfie');
    consent.withdrawFaceConsent(db, 'linked');
    expect(consent.backfillLegacyConsents(db)).toBe(0);
  });
});

describe('a new consent', () => {
  it('records the source and the terms version in force, and no second open row', () => {
    addUser('member', null);
    const db = database.getDatabase();
    consent.recordFaceConsent(db, 'member', 'selfie');
    consent.recordFaceConsent(db, 'member', 'admin');
    expect(rows()).toEqual([
      { user_id: 'member', version: legal.TERMS_VERSION, source: 'selfie', withdrawn_at: null },
    ]);
  });

  it('a withdrawal closes the row, keeps it, and a later link opens a new one', () => {
    addUser('member', PERSON);
    const db = database.getDatabase();
    consent.recordFaceConsent(db, 'member', 'selfie');

    erasure.inTransaction(db, () => erasure.eraseLocalFaceData(db, 'member', 'withdrawal'));
    expect(rows()).toHaveLength(1);
    expect(rows()[0].withdrawn_at).not.toBeNull();

    consent.recordFaceConsent(db, 'member', 'selfie');
    expect(rows().map((r) => r.withdrawn_at === null)).toEqual([false, true]);
  });

  it('is taken by the cascade when the account goes', () => {
    addUser('leaver', PERSON);
    const db = database.getDatabase();
    consent.recordFaceConsent(db, 'leaver', 'selfie');
    expect(erasure.deleteUserAccount(db, 'leaver')).toBe(true);
    expect(rows()).toEqual([]);
  });
});
