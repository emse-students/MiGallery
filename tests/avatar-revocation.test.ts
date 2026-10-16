/**
 * Revoking a user's signed avatar links (src/lib/server/avatar-revocation.ts), against a
 * throwaway SQLite file: the salt is written for that user only, and the signature issued before
 * no longer verifies against the stored salt while the other user's still does.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeTempDir } from './test-helpers';
import { computeAvatarSignature, isAvatarSignatureValid } from '$lib/server/avatar-signature';

let database: typeof import('$lib/db/database');
let revocation: typeof import('$lib/server/avatar-revocation');
let dbDir: string;
const KEY = 'test-signing-key';

const saltOf = (id: string) => revocation.avatarSaltOf(database.getDatabase(), id);

beforeAll(async () => {
  dbDir = mkdtempSync(join(tmpdir(), 'migallery-avatar-rev-'));
  process.env.DATABASE_PATH = join(dbDir, 'avatar-rev.db');
  database = await import('$lib/db/database');
  revocation = await import('$lib/server/avatar-revocation');
  const add = database.getDatabase().prepare('INSERT INTO users (id_user, name) VALUES (?, ?)');
  add.run('alice', 'Alice');
  add.run('bob', 'Bob');
});

afterAll(() => {
  database.resetDatabase();
  removeTempDir(dbDir);
});

describe('account deletion', () => {
  it('rotates the salt even for a user who never revoked, so a same-id account re-validates nothing', async () => {
    const erasure = await import('$lib/server/face-erasure');
    const db = database.getDatabase();
    db.prepare('INSERT INTO users (id_user, name) VALUES (?, ?)').run('dave', 'Dave');
    const issued = computeAvatarSignature(KEY, 'dave', saltOf('dave'));
    expect(erasure.deleteUserAccount(db, 'dave')).toBe(true);
    db.prepare('INSERT INTO users (id_user, name) VALUES (?, ?)').run('dave', 'Dave');
    expect(saltOf('dave')).not.toBeNull();
    expect(isAvatarSignatureValid(KEY, 'dave', issued, saltOf('dave'))).toBe(false);
  });
});

describe('revokeAvatarLinks', () => {
  it('survives the deletion of the account, so a recreated user does not re-validate old URLs', () => {
    const db = database.getDatabase();
    db.prepare('INSERT INTO users (id_user, name) VALUES (?, ?)').run('carol', 'Carol');
    const issued = computeAvatarSignature(KEY, 'carol', saltOf('carol'));
    revocation.revokeAvatarLinks(db, 'carol');
    db.prepare('DELETE FROM users WHERE id_user = ?').run('carol');
    db.prepare('INSERT INTO users (id_user, name) VALUES (?, ?)').run('carol', 'Carol');
    expect(isAvatarSignatureValid(KEY, 'carol', issued, saltOf('carol'))).toBe(false);
  });

  it('starts unsalted, and a revocation salts that user only', () => {
    const issued = computeAvatarSignature(KEY, 'alice', saltOf('alice'));
    const bobIssued = computeAvatarSignature(KEY, 'bob', saltOf('bob'));
    expect(saltOf('alice')).toBeNull();

    expect(revocation.revokeAvatarLinks(database.getDatabase(), 'alice')).toBe(true);

    expect(saltOf('alice')).toMatch(/^[0-9a-f]{32}$/);
    expect(isAvatarSignatureValid(KEY, 'alice', issued, saltOf('alice'))).toBe(false);
    expect(isAvatarSignatureValid(KEY, 'bob', bobIssued, saltOf('bob'))).toBe(true);
  });

  it('revoking again replaces the salt, and an unknown user is reported', () => {
    const first = saltOf('alice');
    revocation.revokeAvatarLinks(database.getDatabase(), 'alice');
    expect(saltOf('alice')).not.toBe(first);
    expect(revocation.revokeAvatarLinks(database.getDatabase(), 'nobody')).toBe(false);
  });
});
