/**
 * THE GATE THAT LETS SHARP BE UPGRADED WITHOUT A HUMAN LOOKING AT AN IMAGE.
 *
 * `sharp` is the only dependency here whose output IS the product: every album cover, every
 * open-graph card and every avatar in this gallery is a buffer it produced. And it is the one
 * dependency whose breakage is invisible to every other gate - an `extract` whose coordinates
 * changed meaning, a `resize` whose `fit: 'cover'` cropped from a different edge, or a `webp()`
 * that started emitting something else all typecheck, lint, build and pass every test that existed
 * before this file. The suite would be green and the first person to find out would be a student
 * whose avatar is a picture of their shoulder.
 *
 * So this asserts the three things `generateFaceCrop` actually asks sharp for, as OBSERVABLE
 * PROPERTIES of the bytes that come back rather than as calls that were made: the output is a
 * square WebP of the declared size, the crop is centred on the face box, and forcing a centre crop
 * lands somewhere else. A mock of sharp would assert nothing at all here, which is why the source
 * image is built with sharp too and read back with it.
 *
 * `generateFaceCrop` takes its `fetch` as a parameter, so no server and no Immich are needed.
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { env } from '$env/dynamic/private';
import { generateFaceCrop, OUTPUT_SIZE } from '$lib/server/face-crop';

/** The synthetic source: a red frame with one green square standing in for a detected face. */
const SRC_W = 400;
const SRC_H = 300;
const FACE = { x1: 40, y1: 30, x2: 120, y2: 110 };
const RED = { r: 220, g: 30, b: 30 };
const GREEN = { r: 30, g: 200, b: 60 };

const CACHE_DIR = path.resolve('data/cache/faces');

let source: Buffer;

/**
 * Builds the source image. The green patch is deliberately in the top-left quadrant so that a
 * face-centred crop and a centre crop cannot both be right: the two assertions below would pass
 * together only if the crop region were being ignored entirely.
 */
async function buildSource(): Promise<Buffer> {
  const patch = await sharp({
    create: {
      width: FACE.x2 - FACE.x1,
      height: FACE.y2 - FACE.y1,
      channels: 3,
      background: GREEN,
    },
  })
    .png()
    .toBuffer();

  return sharp({ create: { width: SRC_W, height: SRC_H, channels: 3, background: RED } })
    .composite([{ input: patch, left: FACE.x1, top: FACE.y1 }])
    .png()
    .toBuffer();
}

/**
 * A `fetch` that answers the exact two calls `generateFaceCrop` makes. `faces` being null stands
 * for "Immich knows no face here", which is the path that falls back to a centre crop.
 */
function fakeFetch(faces: unknown[] | null) {
  return ((url: string) => {
    if (String(url).includes('/api/faces')) {
      if (faces === null) {
        return Promise.resolve(new Response('nope', { status: 404 }));
      }
      return Promise.resolve(
        new Response(JSON.stringify(faces), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );
    }
    if (String(url).includes('/thumbnail')) {
      return Promise.resolve(
        new Response(new Uint8Array(source), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        })
      );
    }
    throw new Error(`unexpected fetch: ${String(url)}`);
  }) as unknown as typeof fetch;
}

/** The face box as Immich reports it, in the same reference frame as the image itself. */
const IMMICH_FACE = {
  boundingBoxX1: FACE.x1,
  boundingBoxY1: FACE.y1,
  boundingBoxX2: FACE.x2,
  boundingBoxY2: FACE.y2,
  imageWidth: SRC_W,
  imageHeight: SRC_H,
  person: { id: 'person-1' },
};

/** Mean colour of the middle ninth of a WebP buffer, decoded back through sharp. */
async function centreColour(buf: Buffer): Promise<{ r: number; g: number; b: number }> {
  const third = Math.floor(OUTPUT_SIZE / 3);
  const { data } = await sharp(buf)
    .extract({ left: third, top: third, width: third, height: third })
    .resize(1, 1, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { r: data[0], g: data[1], b: data[2] };
}

/** Which of the two planted colours a sample is closer to. Lossy WebP shifts every channel. */
function nearest(c: { r: number; g: number; b: number }): 'red' | 'green' {
  const d = (t: typeof RED) => (c.r - t.r) ** 2 + (c.g - t.g) ** 2 + (c.b - t.b) ** 2;
  return d(RED) < d(GREEN) ? 'red' : 'green';
}

beforeAll(async () => {
  // The stub `env` is empty by design. Setting it here rather than in the stub keeps the stub a
  // statement about the module system and this a statement about THIS test's preconditions.
  env.IMMICH_API_KEY = 'test-key';
  env.IMMICH_BASE_URL = 'https://immich.invalid';
  source = await buildSource();
});

beforeEach(() => {
  // `generateFaceCrop` caches on disk, keyed by (asset, person). Without this, every assertion
  // after the first would be reading a file instead of running sharp - the test would stay green
  // through an upgrade that broke every crop.
  //
  // Removing the DIRECTORY rather than the files is deliberate, and it is how the caching defect
  // was found: the cache directory used to be created once at import, so a directory that went
  // away under a running process was never recreated and every crop was recomputed forever after.
  // The last test below fails against that version. `ensureCacheDir` now sits next to the write.
  fs.rmSync(CACHE_DIR, { recursive: true, force: true });
});

describe('generateFaceCrop', () => {
  it('returns a square WebP of the declared size', async () => {
    const result = await generateFaceCrop('asset-1', 'person-1', fakeFetch([IMMICH_FACE]));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const meta = await sharp(result.buffer).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(OUTPUT_SIZE);
    expect(meta.height).toBe(OUTPUT_SIZE);
  });

  it('centres the crop on the face box Immich reported', async () => {
    const result = await generateFaceCrop('asset-2', 'person-1', fakeFetch([IMMICH_FACE]));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The face fills ~62% of the square by design, so the middle ninth is entirely inside it.
    expect(nearest(await centreColour(result.buffer))).toBe('green');
  });

  it('centre-crops the whole image when no face matches', async () => {
    const result = await generateFaceCrop('asset-3', 'center', fakeFetch(null));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The planted patch is in the top-left quadrant, so the centre of a centred square is not it.
    // This is what fails if `extract` is being ignored and the whole image is merely rescaled.
    expect(nearest(await centreColour(result.buffer))).toBe('red');
  });

  it('keeps the crop inside the image when the face sits against an edge', async () => {
    const corner = {
      ...IMMICH_FACE,
      boundingBoxX1: 0,
      boundingBoxY1: 0,
      boundingBoxX2: 30,
      boundingBoxY2: 30,
    };
    // sharp throws on an out-of-bounds `extract`, so the clamping in `computeSquare` is load-bearing
    // and this is the case that exercises both clamps at once.
    const result = await generateFaceCrop('asset-4', 'person-1', fakeFetch([corner]));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const meta = await sharp(result.buffer).metadata();
    expect(meta.width).toBe(OUTPUT_SIZE);
    expect(meta.height).toBe(OUTPUT_SIZE);
  });

  it('serves the second request for the same face from the disk cache', async () => {
    const first = await generateFaceCrop('asset-5', 'person-1', fakeFetch([IMMICH_FACE]));
    // A fetch that answers nothing: if the cache is not used, this throws rather than quietly
    // returning a different image.
    const second = await generateFaceCrop('asset-5', 'person-1', (() => {
      throw new Error('cache miss: the second call went to the network');
    }) as unknown as typeof fetch);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(Buffer.compare(first.buffer, second.buffer)).toBe(0);
  });
});
