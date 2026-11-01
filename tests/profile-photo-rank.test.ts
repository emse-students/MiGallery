/**
 * The default profile photo's ranking and the featured-face overlap (profile-photo-rank.ts), each
 * rule on its own: a test per key, each failing when that key is dropped or reordered.
 */
import { describe, expect, it } from 'vitest';
import {
  boxOverlap,
  compareProfileCandidates,
  rankProfileCandidates,
  type ProfileCandidate,
} from '#lib/profile-photo-rank.ts';

const base: ProfileCandidate = {
  assetId: 'a',
  faceIndex: 0,
  confirmed: false,
  distance: 0.3,
  areaRatio: 0.05,
  score: 0.9,
  facesOnPhoto: 1,
  takenAt: 1000,
};
const c = (over: Partial<ProfileCandidate>): ProfileCandidate => ({ ...base, ...over });
const first = (...list: ProfileCandidate[]) => rankProfileCandidates(list)[0].assetId;

describe('the default profile photo ranking', () => {
  it('a confirmed face before a nearer auto one', () => {
    expect(
      first(
        c({ assetId: 'auto', distance: 0.1 }),
        c({ assetId: 'conf', confirmed: true, distance: 0.5 })
      )
    ).toBe('conf');
  });

  it('closeness by steps of 0.05, before size', () => {
    expect(
      first(c({ assetId: 'big', distance: 0.36, areaRatio: 0.5 }), c({ assetId: 'near' }))
    ).toBe('near');
    // Inside one step, the larger face wins.
    expect(
      first(c({ assetId: 'small' }), c({ assetId: 'big', distance: 0.34, areaRatio: 0.5 }))
    ).toBe('big');
  });

  it("the detector's score, a seeded face (no score) last", () => {
    expect(first(c({ assetId: 'seed', score: null }), c({ assetId: 'low', score: 0.71 }))).toBe(
      'low'
    );
  });

  it('a single-face photo before a group photo', () => {
    expect(first(c({ assetId: 'group', facesOnPhoto: 6 }), c({ assetId: 'solo' }))).toBe('solo');
  });

  it('the more recent capture date, an unknown one last', () => {
    expect(
      first(
        c({ assetId: 'old', takenAt: 1 }),
        c({ assetId: 'new', takenAt: 9 }),
        c({ assetId: 'unknown', takenAt: null })
      )
    ).toBe('new');
  });

  it('a fixed tie-break on the asset id: the same choice in any input order', () => {
    const list = [c({ assetId: 'b' }), c({ assetId: 'c' }), c({ assetId: 'a' })];
    expect(first(...list)).toBe('a');
    expect(first(...[...list].reverse())).toBe('a');
    expect(compareProfileCandidates(c({}), c({}))).toBe(0);
  });
});

describe('the featured face overlap', () => {
  it('finds the same face in a frame of another size, and none apart', () => {
    const stored = { x1: 40, y1: 30, x2: 120, y2: 110, imgW: 400, imgH: 300 };
    expect(
      boxOverlap({ x1: 80, y1: 60, x2: 240, y2: 220, imgW: 800, imgH: 600 }, stored)
    ).toBeCloseTo(1, 6);
    expect(boxOverlap({ x1: 300, y1: 200, x2: 380, y2: 280, imgW: 400, imgH: 300 }, stored)).toBe(
      0
    );
    expect(boxOverlap({ ...stored, imgW: 0 }, stored)).toBe(0);
  });
});
