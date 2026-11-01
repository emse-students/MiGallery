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
 * So this asserts the three things `generateMemberFaceCrop` actually asks sharp for, as OBSERVABLE
 * PROPERTIES of the bytes that come back rather than as calls that were made: the output is a
 * square WebP of the declared size, the crop is centred on the face box the store holds (lot A6),
 * and an unusable box lands somewhere else. A mock of sharp would assert nothing at all here,
 * which is why the source image is built with sharp too and read back with it. It also pins where
 * a crop lives: in its member's directory, which a withdrawal deletes whole.
 *
 * `generateMemberFaceCrop` takes its `fetch` as a parameter, so no server and no Immich are needed.
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { env } from '#lib/server/env.ts';
import {
  deleteMemberFaceCrop,
  deleteMemberFaceCrops,
  generateMemberFaceCrop,
  memberCropDir,
  OUTPUT_SIZE,
  type FaceBox,
} from '#lib/server/face-crop.ts';

/** The synthetic source: a red frame with one green square standing in for a detected face. */
const SRC_W = 400;
const SRC_H = 300;
const FACE = { x1: 40, y1: 30, x2: 120, y2: 110 };
const RED = { r: 220, g: 30, b: 30 };
const GREEN = { r: 30, g: 200, b: 60 };

const CACHE_DIR = path.resolve('data/cache/faces');

/** The face box as the store keeps it, in the same reference frame as the image itself. */
const BOX: FaceBox = { ...FACE, imgW: SRC_W, imgH: SRC_H };
const MEMBER = 'member.one';
const held = () => true;

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

/** A `fetch` that answers the one call a crop makes: the preview of the photo. */
function fakeFetch() {
  return ((url: string) => {
    if (String(url).includes('/thumbnail?size=preview')) {
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

/** One crop of MEMBER's face `faceIndex` in `assetId`, cut around `box`. */
const crop = (assetId: string, box: FaceBox = BOX, member = MEMBER, faceIndex = 0) =>
  generateMemberFaceCrop(member, { assetId, faceIndex }, box, fakeFetch(), held);

const cached = (member: string, file: string) =>
  fs.existsSync(path.join(memberCropDir(member), file));

beforeAll(async () => {
  // The stub `env` is empty by design. Setting it here rather than in the stub keeps the stub a
  // statement about the module system and this a statement about THIS test's preconditions.
  env.IMMICH_API_KEY = 'test-key';
  env.IMMICH_BASE_URL = 'https://immich.invalid';
  source = await buildSource();
});

beforeEach(() => {
  // A crop is cached on disk, keyed by (member, asset, face). Without this, every assertion after
  // the first would be reading a file instead of running sharp - the test would stay green
  // through an upgrade that broke every crop.
  //
  // Removing the DIRECTORY rather than the files is deliberate: a directory that goes away under
  // a running process (a withdrawal removes a member's on purpose) must be recreated by the next
  // write. `ensureCacheDir` sits next to the write for that reason.
  fs.rmSync(CACHE_DIR, { recursive: true, force: true });
});

describe('generateMemberFaceCrop', () => {
  it('returns a square WebP of the declared size', async () => {
    const result = await crop('asset-1');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const meta = await sharp(result.buffer).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(OUTPUT_SIZE);
    expect(meta.height).toBe(OUTPUT_SIZE);
  });

  it('centres the crop on the stored face box', async () => {
    const result = await crop('asset-2');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The face fills ~62% of the square by design, so the middle ninth is entirely inside it.
    expect(nearest(await centreColour(result.buffer))).toBe('green');
  });

  it('scales a box given in another frame than the preview', async () => {
    // The detector saw the image at twice the size: the box must be halved to land on the face.
    const result = await crop('asset-6', {
      x1: FACE.x1 * 2,
      y1: FACE.y1 * 2,
      x2: FACE.x2 * 2,
      y2: FACE.y2 * 2,
      imgW: SRC_W * 2,
      imgH: SRC_H * 2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(nearest(await centreColour(result.buffer))).toBe('green');
  });

  it('centre-crops the whole image when the box is unusable', async () => {
    const result = await crop('asset-3', { ...BOX, imgW: 0 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The planted patch is in the top-left quadrant, so the centre of a centred square is not it.
    // This is what fails if `extract` is being ignored and the whole image is merely rescaled.
    expect(nearest(await centreColour(result.buffer))).toBe('red');
  });

  it('keeps the crop inside the image when the face sits against an edge', async () => {
    // sharp throws on an out-of-bounds `extract`, so the clamping in `computeSquare` is load-bearing
    // and this is the case that exercises both clamps at once.
    const result = await crop('asset-4', {
      x1: 0,
      y1: 0,
      x2: 30,
      y2: 30,
      imgW: SRC_W,
      imgH: SRC_H,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const meta = await sharp(result.buffer).metadata();
    expect(meta.width).toBe(OUTPUT_SIZE);
    expect(meta.height).toBe(OUTPUT_SIZE);
  });

  it('serves the second request for the same face from the member cache', async () => {
    const face = { assetId: 'asset-5', faceIndex: 1 };
    const first = await generateMemberFaceCrop(MEMBER, face, BOX, fakeFetch(), held);
    // A fetch that answers nothing: if the cache is not used, this throws rather than quietly
    // returning a different image.
    const second = await generateMemberFaceCrop(
      MEMBER,
      face,
      BOX,
      (() => {
        throw new Error('cache miss: the second call went to the network');
      }) as unknown as typeof fetch,
      held
    );

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(Buffer.compare(first.buffer, second.buffer)).toBe(0);
    expect(cached(MEMBER, 'asset-5_1.webp')).toBe(true);
  });

  it('keeps no file of a face the member stopped holding while it was cut', async () => {
    const face = { assetId: 'asset-7', faceIndex: 0 };
    const result = await generateMemberFaceCrop(MEMBER, face, BOX, fakeFetch(), () => false);
    expect(result.ok).toBe(true);
    expect(cached(MEMBER, 'asset-7_0.webp')).toBe(false);
  });

  it('refuses an asset id that is not a file name, and asks nothing', async () => {
    const result = await generateMemberFaceCrop(
      MEMBER,
      { assetId: '../escape', faceIndex: 0 },
      BOX,
      (() => {
        throw new Error('no call expected');
      }) as unknown as typeof fetch,
      held
    );
    expect(result).toEqual({ ok: false, reason: 'notfound' });
  });
});

describe('the member crop directory', () => {
  it('is one directory per member, under the cache root, whatever the id', () => {
    const dir = memberCropDir('../../etc');
    expect(dir.startsWith(path.join(CACHE_DIR, 'members'))).toBe(true);
    expect(path.basename(dir)).toMatch(/^[0-9a-f]{32}$/);
    expect(memberCropDir('a')).not.toBe(memberCropDir('b'));
  });

  it('a withdrawal deletes every crop of the member and none of another', async () => {
    await crop('w1');
    await crop('w1', BOX, 'other');
    expect(deleteMemberFaceCrops(MEMBER)).toBe(true);
    expect(fs.existsSync(memberCropDir(MEMBER))).toBe(false);
    expect(cached('other', 'w1_0.webp')).toBe(true);
    // Nothing left to delete is not an error.
    expect(deleteMemberFaceCrops(MEMBER)).toBe(false);
  });

  it('an answer of "not me" deletes that one crop', async () => {
    await crop('r1', BOX, MEMBER, 2);
    await crop('r2');
    deleteMemberFaceCrop(MEMBER, { assetId: 'r1', faceIndex: 2 });
    expect(cached(MEMBER, 'r1_2.webp')).toBe(false);
    expect(cached(MEMBER, 'r2_0.webp')).toBe(true);
  });
});
