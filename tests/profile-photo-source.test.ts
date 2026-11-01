/**
 * `users.photos_asset_source` on a database made before it: every photo already set was a CHOICE
 * (the picker, or the A7 seed carrying a chosen photo over), so a default never replaces it.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeTempDir } from './test-helpers';
import { ensureSchema, openSqliteFile } from '#lib/db/database.ts';

describe('the profile photo source column', () => {
  it('is added once, marking every photo already set as chosen', () => {
    const dir = mkdtempSync(join(tmpdir(), 'migallery-photo-source-'));
    const db = openSqliteFile(join(dir, 'old.db'));
    try {
      db.exec(
        'CREATE TABLE users (id_user TEXT PRIMARY KEY, name TEXT, photos_id TEXT, photos_asset_id TEXT)'
      );
      db.exec(
        "INSERT INTO users (id_user, name, photos_asset_id) VALUES ('a', 'a', 'asset-1'), ('b', 'b', NULL)"
      );
      ensureSchema(db);
      const rows = () =>
        db.prepare('SELECT id_user, photos_asset_source FROM users ORDER BY id_user').all();
      expect(rows()).toEqual([
        { id_user: 'a', photos_asset_source: 'chosen' },
        { id_user: 'b', photos_asset_source: null },
      ]);
      // A second start changes nothing (the column exists: the step does not run again).
      db.exec("UPDATE users SET photos_asset_source = 'default' WHERE id_user = 'a'");
      ensureSchema(db);
      expect(rows()[0]).toEqual({ id_user: 'a', photos_asset_source: 'default' });
    } finally {
      db.close?.(false);
      removeTempDir(dir);
    }
  });
});
