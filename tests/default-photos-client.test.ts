/**
 * The one-off default-photo client (scripts/faces/default-photos-client.mjs): it parses Immich's
 * export (G: featured faces, P: assets Immich still holds), and it refuses an export missing
 * either unless `--no-featured` says an empty one is meant - a failed or wrong export must never
 * silently run without them (reviews of #433, 2026-11-01).
 */

import { describe, it, expect } from 'vitest';
import { checkExport, parseExport } from '../scripts/faces/default-photos-client.mjs';

describe('the default-photo client', () => {
  it('parses featured faces and present assets, one per line', () => {
    expect(parseExport('G\tp1\ta1\t1\t2\t3\t4\t400\t300\nP\ta1\nP\tlocked1\n\n')).toEqual({
      featured: [{ person: 'p1', assetId: 'a1', x1: 1, y1: 2, x2: 3, y2: 4, imgW: 400, imgH: 300 }],
      present: ['a1', 'locked1'],
    });
    expect(() => parseExport('G\tp1\ta1\t1\t2\n')).toThrow(/line 1/);
    expect(() => parseExport('P\n')).toThrow(/line 1/);
  });

  it('refuses an export missing its G or P lines unless --no-featured, and the flag with an export', () => {
    const g = [{}];
    const p = ['a1'];
    expect(() => checkExport({ featured: [], present: [] }, false)).toThrow(/--no-featured/);
    expect(() => checkExport({ featured: g, present: [] }, false)).toThrow(/\(P\)/);
    expect(() => checkExport({ featured: [], present: p }, false)).toThrow(/\(G\)/);
    expect(() => checkExport({ featured: g, present: p }, false)).not.toThrow();
    expect(() => checkExport({ featured: [], present: [] }, true)).not.toThrow();
    expect(() => checkExport({ featured: g, present: [] }, true)).toThrow(/carries an export/);
    expect(() => checkExport({ featured: [], present: p }, true)).toThrow(/carries an export/);
  });
});
