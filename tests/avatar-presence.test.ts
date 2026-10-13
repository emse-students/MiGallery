/**
 * `GET /api/users/avatar-presence` states, for a list, the fact `GET /api/users/<id>/avatar` states
 * one id at a time by answering 404: no `users` row, or a row with no `photos_id`. Canari asks it so
 * a salon of members without a photo costs one request instead of one refused request per face.
 *
 * Pure DB assertions against a throwaway SQLite file - no server, no network.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeTempDir } from './test-helpers';

let presence: typeof import('$lib/server/avatar-presence');
let database: typeof import('$lib/db/database');
let dbDir: string;

beforeAll(async () => {
  // DB_PATH is read once at module load, so the env is set BEFORE the first import.
  dbDir = mkdtempSync(join(tmpdir(), 'migallery-presence-'));
  process.env.DATABASE_PATH = join(dbDir, 'presence.db');
  presence = await import('$lib/server/avatar-presence');
  database = await import('$lib/db/database');
  const insert = database
    .getDatabase()
    .prepare('INSERT INTO users (id_user, name, photos_id, role) VALUES (?, ?, ?, ?)');
  insert.run('with-photo', 'A', 'immich-person-1', 'user');
  insert.run('null-photo', 'B', null, 'user');
  insert.run('empty-photo', 'C', '', 'user');
});

afterAll(() => {
  database.resetDatabase();
  removeTempDir(dbDir);
});

describe('which users have a photo', () => {
  it('lists only the ids the avatar route would answer with an image', () => {
    expect(
      presence.usersWithPhoto(['with-photo', 'null-photo', 'empty-photo', 'unknown-user'])
    ).toEqual(['with-photo']);
  });

  it('asks nothing for an empty list', () => {
    expect(presence.usersWithPhoto([])).toEqual([]);
  });
});

describe('the ids it is asked about', () => {
  it('reads a comma-separated list, trimmed and deduplicated', () => {
    expect(presence.parseAvatarPresenceIds(' a, b ,a,,c ')).toEqual(['a', 'b', 'c']);
  });

  it('refuses an empty list rather than answering "nobody has a photo"', () => {
    expect(() => presence.parseAvatarPresenceIds(null)).toThrow(
      presence.AvatarPresenceRequestError
    );
    expect(() => presence.parseAvatarPresenceIds(' , ')).toThrow(
      presence.AvatarPresenceRequestError
    );
  });

  it('refuses a list longer than the cap rather than answering part of it', () => {
    const ids = Array.from(
      { length: presence.MAX_AVATAR_PRESENCE_IDS + 1 },
      (_, i) => `user-${String(i)}`
    );
    expect(() => presence.parseAvatarPresenceIds(ids.join(','))).toThrow(/too many ids/);
    expect(
      presence.parseAvatarPresenceIds(ids.slice(0, presence.MAX_AVATAR_PRESENCE_IDS).join(','))
    ).toHaveLength(presence.MAX_AVATAR_PRESENCE_IDS);
  });
});
