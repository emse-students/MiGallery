import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = {
  visibility: undefined as string | undefined,
  members: [] as string[],
  fail: false,
};
const requireScope = vi.fn();

vi.mock('#lib/server/env.ts', () => ({
  env: { IMMICH_BASE_URL: 'http://immich', IMMICH_API_KEY: 'k' },
}));
vi.mock('#lib/db/database.ts', () => ({
  getDatabase: () => ({
    prepare: () => ({
      get: () => (state.visibility === undefined ? undefined : { visibility: state.visibility }),
    }),
  }),
}));
vi.mock('#lib/immich/album-assets.ts', () => ({
  fetchAlbumAssets: async () => {
    if (state.fail) {
      throw new Error('immich down');
    }
    return state.members.map((id) => ({ id }));
  },
}));
vi.mock('#lib/server/permissions.ts', () => ({
  requireScope: (...a: unknown[]) => requireScope(...a),
}));
vi.mock('#lib/server/logger.ts', () => ({
  createLogger: () => ({ warn() {}, error() {}, debug() {}, info() {} }),
}));

import {
  requireAlbumAssetAccess,
  requireAlbumAccess,
  clearAlbumMembershipCache,
} from '../src/lib/server/album-asset-access';

// The request carries a `?visibility=unlisted` hint on purpose: it must change nothing.
const event = { fetch, request: new Request('http://x/?visibility=unlisted') } as never;

beforeEach(() => {
  requireScope.mockReset().mockImplementation(async () => {
    throw new Error('requires a session');
  });
  clearAlbumMembershipCache();
  state.visibility = undefined;
  state.members = [];
  state.fail = false;
});

describe('requireAlbumAssetAccess', () => {
  it('ignores a visibility hint in the request: a private album needs a session', async () => {
    state.visibility = 'private';
    state.members = ['a1'];
    await expect(requireAlbumAssetAccess(event, 'alb', 'a1')).rejects.toThrow('requires a session');
  });

  it('an unknown album needs a session', async () => {
    await expect(requireAlbumAssetAccess(event, 'alb', 'a1')).rejects.toThrow('requires a session');
  });

  it('lets an unlisted album serve its own photo without a session', async () => {
    state.visibility = 'unlisted';
    state.members = ['a1'];
    await expect(requireAlbumAssetAccess(event, 'alb', 'a1')).resolves.toBeUndefined();
    expect(requireScope).not.toHaveBeenCalled();
  });

  it('does not let an unlisted album id unlock a photo that is not in it', async () => {
    state.visibility = 'unlisted';
    state.members = ['a1'];
    await expect(requireAlbumAssetAccess(event, 'alb', 'other')).rejects.toThrow(
      'requires a session'
    );
  });
});

describe('requireAlbumAssetAccess failure modes', () => {
  it('fails closed when Immich is down', async () => {
    state.visibility = 'unlisted';
    state.fail = true;
    await expect(requireAlbumAssetAccess(event, 'alb', 'a1')).rejects.toThrow('requires a session');
  });

  it('does not cache an empty list, so the next request can succeed', async () => {
    state.visibility = 'unlisted';
    await expect(requireAlbumAssetAccess(event, 'alb', 'a1')).rejects.toThrow('requires a session');
    state.members = ['a1'];
    await expect(requireAlbumAssetAccess(event, 'alb', 'a1')).resolves.toBeUndefined();
  });

  it('reads the visibility case-insensitively, like the album page does', async () => {
    state.visibility = 'Unlisted';
    state.members = ['a1'];
    await expect(requireAlbumAssetAccess(event, 'alb', 'a1')).resolves.toBeUndefined();
  });
});

describe('requireAlbumAccess', () => {
  it('is public only for an unlisted album', async () => {
    state.visibility = 'unlisted';
    await expect(requireAlbumAccess(event, 'alb')).resolves.toBeUndefined();
    state.visibility = 'authenticated';
    await expect(requireAlbumAccess(event, 'alb')).rejects.toThrow('requires a session');
  });
});
