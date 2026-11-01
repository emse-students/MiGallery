/**
 * The one-off default-photo client (scripts/faces/default-photos-client.mjs): it parses Immich's
 * export (G: featured faces, P: assets Immich still holds), and it refuses an export missing
 * either unless `--no-featured` says an empty one is meant - a failed or wrong export must never
 * silently run without them (reviews of #433, 2026-11-01).
 */

import { describe, it, expect } from 'vitest';
import {
  checkExport,
  keepWanted,
  parseExport,
  readWanted,
} from '../scripts/faces/default-photos-client.mjs';

describe('the default-photo client', () => {
  it('parses featured faces and present assets, one per line', () => {
    expect(parseExport('G\tp1\ta1\t1\t2\t3\t4\t400\t300\nP\ta1\nP\tlocked1\n\n')).toEqual({
      featured: [{ person: 'p1', assetId: 'a1', x1: 1, y1: 2, x2: 3, y2: 4, imgW: 400, imgH: 300 }],
      present: ['a1', 'locked1'],
    });
    expect(() => parseExport('G\tp1\ta1\t1\t2\n')).toThrow(/line 1/);
    expect(() => parseExport('P\n')).toThrow(/line 1/);
  });

  it('keeps only the featured faces of linked members, case-insensitively, under the server cap', () => {
    // The production shape: far more persons than members (6,000 unlinked here, 94k there).
    const face = (person: string) => ({
      person,
      assetId: 'a',
      x1: 1,
      y1: 2,
      x2: 3,
      y2: 4,
      imgW: 4,
      imgH: 3,
    });
    const featured = [
      ...Array.from({ length: 6000 }, (_, i) => face(`unlinked-${i}`)),
      face('AAAA-Person'),
      face('cccc-person'),
    ];
    expect(featured.length).toBeGreaterThan(5000);
    const sent = keepWanted(featured, ['aaaa-person', 'CCCC-PERSON', 'nobody-in-export']);
    expect(sent.map((f) => f.person)).toEqual(['AAAA-Person', 'cccc-person']);
    expect(keepWanted(featured, [])).toEqual([]);
  });

  it('says so when the server does not know ?wanted=1 (an older one answers the run state)', () => {
    expect(readWanted({ success: true, people: ['p'] })).toEqual(['p']);
    expect(() => readWanted({ success: true, status: 'idle' })).toThrow(
      /does not support \?wanted=1/
    );
    expect(() => readWanted(null)).toThrow(/does not support/);
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
