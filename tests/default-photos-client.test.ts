/**
 * The one-off default-photo client (scripts/faces/default-photos-client.mjs): it parses Immich's
 * export, and it refuses an EMPTY export unless `--no-featured` says that is meant - a failed or
 * wrong export must never silently run without the featured faces (review of #433, 2026-11-01).
 */

import { describe, it, expect } from 'vitest';
import { checkFeaturedCount, parseFeatured } from '../scripts/faces/default-photos-client.mjs';

describe('the default-photo client', () => {
  it('parses one featured face per line', () => {
    expect(parseFeatured('G\tp1\ta1\t1\t2\t3\t4\t400\t300\n\n')).toEqual([
      { person: 'p1', assetId: 'a1', x1: 1, y1: 2, x2: 3, y2: 4, imgW: 400, imgH: 300 },
    ]);
    expect(() => parseFeatured('G\tp1\ta1\t1\t2\n')).toThrow(/line 1/);
  });

  it('refuses an empty export unless --no-featured, and the flag with faces', () => {
    expect(() => checkFeaturedCount(0, false)).toThrow(/--no-featured/);
    expect(() => checkFeaturedCount(0, true)).not.toThrow();
    expect(() => checkFeaturedCount(3, false)).not.toThrow();
    expect(() => checkFeaturedCount(3, true)).toThrow(/stdin carries/);
  });
});
