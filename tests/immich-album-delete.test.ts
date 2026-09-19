import { describe, expect, it } from 'vitest';
import { deleteOrphanedAlbumAssets } from '$lib/server/immich-album-delete';

type RequestRecord = { url: string; method: string };

describe('deleteOrphanedAlbumAssets', () => {
  it('deletes only assets that have no other album', async () => {
    const requests: RequestRecord[] = [];
    const fetchFn: typeof fetch = async (input, init) => {
      const url = String(input);
      const method = init?.method || 'GET';
      requests.push({ url, method });

      if (url.endsWith('/api/assets/orphan')) {
        return new Response(JSON.stringify({ albums: [{ id: 'album-1' }] }), { status: 200 });
      }
      if (url.endsWith('/api/assets/shared')) {
        return new Response(JSON.stringify({ albums: [{ id: 'album-1' }, { id: 'album-2' }] }), {
          status: 200,
        });
      }
      if (url.endsWith('/api/assets/unverified')) {
        return new Response('upstream failure', { status: 503 });
      }
      if (url.endsWith('/api/assets') && method === 'DELETE') {
        return new Response('[]', { status: 200 });
      }
      return new Response('not found', { status: 404 });
    };

    const result = await deleteOrphanedAlbumAssets(
      fetchFn,
      'album-1',
      ['orphan', 'shared', 'unverified'],
      'https://immich.test',
      'test-key'
    );

    expect(result).toEqual({
      checked: 3,
      deleted: 1,
      skipped: 2,
      verificationFailures: 1,
    });
    expect(requests.filter((request) => request.method === 'DELETE')).toHaveLength(1);
  });

  it('does not call Immich when there are no assets', async () => {
    let calls = 0;
    const fetchFn: typeof fetch = async () => {
      calls++;
      return new Response('[]', { status: 200 });
    };

    const result = await deleteOrphanedAlbumAssets(
      fetchFn,
      'album-1',
      [],
      'https://immich.test',
      'test-key'
    );

    expect(result.deleted).toBe(0);
    expect(calls).toBe(0);
  });
});
