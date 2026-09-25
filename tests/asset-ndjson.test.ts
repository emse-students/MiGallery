/**
 * The grid streams (`src/lib/server/asset-ndjson.ts`).
 *
 * Pure, no server needed: this runs under `bun run test:unit`. What it pins is
 * the weight of a line - the owner/EXIF/path of a search result must never
 * leak back into the stream, since every byte crosses a lossy uplink - and
 * the gzip negotiation.
 */

import { describe, it, expect } from 'vitest';
import { assetsNdjsonResponse, slimAsset } from '$lib/server/asset-ndjson';
import type { ImmichAsset } from '$lib/types/api';

const searchResult = {
  id: 'a1',
  type: 'IMAGE',
  originalFileName: 'IMG_2042.jpg',
  fileCreatedAt: '2026-09-20T00:56:17.270Z',
  createdAt: '2026-09-22T22:26:10.069Z',
  updatedAt: '2026-09-22T22:26:10.828Z',
  width: 6000,
  height: 4000,
  ownerId: 'owner',
  originalPath: '/usr/src/app/upload/library/admin/IMG_2042.jpg',
  checksum: 'abc',
  people: [{ id: 'p1', name: 'Someone' }],
  exifInfo: { make: 'Canon', exifImageWidth: 6000, exifImageHeight: 4000 },
} as unknown as ImmichAsset;

function request(acceptEncoding?: string): Request {
  return new Request('http://localhost/api/albums/x/assets-stream', {
    headers: acceptEncoding ? { 'accept-encoding': acceptEncoding } : {},
  });
}

async function lines(res: Response, gzipped: boolean): Promise<unknown[]> {
  const body = gzipped
    ? res.body!.pipeThrough(new DecompressionStream('gzip'))
    : (res.body as ReadableStream<Uint8Array>);
  const text = await new Response(body).text();
  return text
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

describe('slimAsset', () => {
  it('keeps exactly what the grid reads', () => {
    expect(slimAsset(searchResult)).toEqual({
      id: 'a1',
      type: 'IMAGE',
      originalFileName: 'IMG_2042.jpg',
      fileCreatedAt: '2026-09-20T00:56:17.270Z',
      createdAt: '2026-09-22T22:26:10.069Z',
      updatedAt: '2026-09-22T22:26:10.828Z',
      width: 6000,
      height: 4000,
    });
  });

  it('sends null dimensions rather than dropping the keys', () => {
    const { width, height, ...rest } = searchResult;
    void width;
    void height;
    expect(slimAsset(rest as ImmichAsset)).toMatchObject({ width: null, height: null });
  });
});

describe('assetsNdjsonResponse', () => {
  it('writes one full-phase line per asset, in order', async () => {
    const res = assetsNdjsonResponse([searchResult, { ...searchResult, id: 'a2' }], request());
    expect(res.headers.get('content-type')).toBe('application/x-ndjson');
    expect(res.headers.get('content-encoding')).toBeNull();
    const parsed = (await lines(res, false)) as { phase: string; asset: { id: string } }[];
    expect(parsed.map((l) => [l.phase, l.asset.id])).toEqual([
      ['full', 'a1'],
      ['full', 'a2'],
    ]);
  });

  it('gzips when the client accepts it, and says so to caches', async () => {
    const res = assetsNdjsonResponse([searchResult], request('gzip, deflate, br, zstd'));
    expect(res.headers.get('content-encoding')).toBe('gzip');
    expect(res.headers.get('vary')).toBe('Accept-Encoding');
    const parsed = (await lines(res, true)) as { asset: unknown }[];
    expect(parsed[0].asset).toEqual(slimAsset(searchResult));
  });

  it('answers an empty body for an empty album', async () => {
    const res = assetsNdjsonResponse([], request('gzip'));
    expect(await lines(res, true)).toEqual([]);
  });
});
