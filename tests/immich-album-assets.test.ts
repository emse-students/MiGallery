import { describe, expect, it, vi } from 'vitest';
import { fetchAlbumAssets } from '../src/lib/immich/album-assets';

/** An album id of the shape Immich issues: only such an id reaches an Immich URL. */
const ALBUM = '00000000-0000-4000-8000-000000000001';

describe('Immich album asset resolver', () => {
  it('uses search metadata when the album payload omits assets', async () => {
    const expectedAssets = [{ id: 'asset-1' }, { id: 'asset-2' }];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ assets: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ assets: { items: expectedAssets } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );

    const assets = await fetchAlbumAssets(
      fetchMock as unknown as typeof fetch,
      'http://immich',
      'api-key',
      ALBUM
    );

    expect(assets).toEqual(expectedAssets);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://immich/api/search/metadata',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-api-key': 'api-key' }),
      })
    );
  });
});
