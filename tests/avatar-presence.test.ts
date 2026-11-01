/**
 * `GET /api/users/avatar-presence` states, for a list, the fact `GET /api/users/<id>/avatar` states
 * one id at a time by answering 404: no `users` row, no chosen profile photo, or a chosen photo that
 * is no longer one of the member's own (lot A6: a face of theirs there, shown). Canari asks it so
 * a salon of members without a photo costs one request instead of one refused request per face.
 *
 * Pure DB assertions against a throwaway SQLite file - no server, no network.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeTempDir } from './test-helpers';
import { FACE_MODEL } from '#lib/face-embedding.ts';

let presence: typeof import('#lib/server/avatar-presence.ts');
let database: typeof import('#lib/db/database.ts');
let dbDir: string;

beforeAll(async () => {
  // DB_PATH is read once at module load, so the env is set BEFORE the first import.
  dbDir = mkdtempSync(join(tmpdir(), 'migallery-presence-'));
  process.env.DATABASE_PATH = join(dbDir, 'presence.db');
  presence = await import('#lib/server/avatar-presence.ts');
  database = await import('#lib/db/database.ts');
  const db = database.getDatabase();
  const user = db.prepare(
    'INSERT INTO users (id_user, name, photos_id, photos_asset_id, role) VALUES (?, ?, ?, ?, ?)'
  );
  // `photos_id` is the retired Immich person link: holding one no longer gives a photo.
  user.run('with-photo', 'A', null, 'asset-a', 'user');
  user.run('confirmed', 'B', null, 'asset-b', 'user');
  user.run('null-photo', 'C', 'immich-person-1', null, 'user');
  user.run('empty-photo', 'D', null, '', 'user');
  user.run('not-theirs', 'E', null, 'asset-e', 'user');
  user.run('rejected', 'F', null, 'asset-f', 'user');
  user.run('waiting', 'G', null, 'asset-g', 'user');
  user.run('other-model', 'H', null, 'asset-h', 'user');
  const match = db.prepare(
    `INSERT INTO face_matches (asset_id, face_index, model, user_id, distance, band, state, created_at)
     VALUES (?, 0, ?, ?, 0.3, ?, ?, 1)`
  );
  match.run('asset-a', FACE_MODEL, 'with-photo', 'auto', 'pending');
  match.run('asset-b', FACE_MODEL, 'confirmed', 'suggested', 'confirmed');
  match.run('asset-e', FACE_MODEL, 'with-photo', 'auto', 'pending');
  match.run('asset-f', FACE_MODEL, 'rejected', 'auto', 'rejected');
  match.run('asset-g', FACE_MODEL, 'waiting', 'suggested', 'pending');
  match.run('asset-h', 'another-model', 'other-model', 'auto', 'pending');
});

afterAll(() => {
  database.resetDatabase();
  removeTempDir(dbDir);
});

describe('which users have a photo', () => {
  it('lists only the ids the avatar route would answer with an image', () => {
    expect(
      presence
        .usersWithPhoto([
          'with-photo',
          'confirmed',
          'null-photo',
          'empty-photo',
          'not-theirs',
          'rejected',
          'waiting',
          'other-model',
          'unknown-user',
        ])
        .sort()
    ).toEqual(['confirmed', 'with-photo']);
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
