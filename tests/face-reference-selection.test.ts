/**
 * Faces v2 (the owner's decisions of 2026-11-01, docs/wiki/face-matching-option-c.md): the pure
 * rules of a member's references and negatives - variety, renewal towards recent photos, the
 * anti-drift bound, the negatives' withholding - and the confirmation screen's list operations.
 * Vectors are 2-D unit vectors at an ANGLE, so a distance reads at a glance: 1 - cos(angle).
 */

import { describe, it, expect } from 'vitest';
import {
  decideLearning,
  growUntilStable,
  redundantVictim,
  selectVariedReferences,
  type ReferenceItem,
} from '#lib/face-reference-selection.ts';
import { decideFace, withheldByNegative } from '#lib/face-match.ts';
import { cosineDistance } from '#lib/face-embedding.ts';
import { removeKeys, restoreAt, type Suggestion } from '#lib/face-confirm-list.ts';

/** A unit vector at `angle` radians. */
const at = (angle: number) => Float32Array.from([Math.cos(angle), Math.sin(angle)]);

/** The angle whose cosine distance from 0 is `d`. */
const angleOf = (d: number) => Math.acos(1 - d);

function item(key: string, angle: number, takenAt: number | null, anchor = false): ReferenceItem {
  return { key, embedding: at(angle), takenAt, anchor };
}

/** A deterministic shuffle (mulberry32). */
function shuffled<T>(list: readonly T[], seed: number): T[] {
  let a = seed >>> 0;
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

describe('selectVariedReferences: variety, not centrality', () => {
  // Ten near-identical frontal faces around 0, and two real variations (a profile, a light).
  const cluster = Array.from({ length: 10 }, (_, i) => item(`c${i}`, i * 0.01, 100 + i));
  const variations = [item('left', -0.6, 50), item('right', 0.6, 60)];
  const pool = [...cluster, ...variations];

  it('covers the variations a centroid choice would leave out', () => {
    const chosen = selectVariedReferences(pool, 3).map((c) => c.key);
    expect(chosen).toContain('left');
    expect(chosen).toContain('right');
    // The centroid choice (the faces nearest the mean): the cluster only, no variation.
    const mean = [0, 0];
    for (const p of pool) {
      mean[0] += p.embedding[0];
      mean[1] += p.embedding[1];
    }
    const central = [...pool]
      .sort((a, b) => cosineDistance(a.embedding, mean) - cosineDistance(b.embedding, mean))
      .slice(0, 3)
      .map((c) => c.key);
    expect(central.some((k) => k === 'left' || k === 'right')).toBe(false);
  });

  it('gives the same set in the same order whatever the order of the pool', () => {
    const reference = selectVariedReferences(pool, 5).map((c) => c.key);
    for (let seed = 1; seed <= 20; seed++) {
      expect(selectVariedReferences(shuffled(pool, seed), 5).map((c) => c.key)).toEqual(reference);
    }
  });

  it('keeps the anchor (the selfie) first, even at a cap of one', () => {
    const withSelfie = [...pool, item('selfie', 0.02, 1, true)];
    expect(selectVariedReferences(withSelfie, 1).map((c) => c.key)).toEqual(['selfie']);
    expect(selectVariedReferences(withSelfie, 4)[0].key).toBe('selfie');
  });

  it('starts from the most recent face without an anchor, and prefers the newer on a tie', () => {
    expect(selectVariedReferences(pool, 1).map((c) => c.key)).toEqual(['c9']);
    // Two faces at the same place: the newer one is chosen.
    const twins = [item('a', 0, 10), item('old', 1, 1), item('new', 1, 2)];
    expect(selectVariedReferences(twins, 2).map((c) => c.key)).toEqual(['a', 'new']);
  });

  it('never chooses a vector that cannot be compared', () => {
    const broken: ReferenceItem[] = [
      { key: 'nan', embedding: Float32Array.from([Number.NaN, 1]), takenAt: 999 },
      { key: 'zero', embedding: Float32Array.from([0, 0]), takenAt: 998 },
      item('ok', 0, 1),
    ];
    expect(selectVariedReferences(broken, 3).map((c) => c.key)).toEqual(['ok']);
  });
});

describe('redundantVictim: the least useful reference', () => {
  it('is the older of the two closest', () => {
    const set = [item('a', 0, 10), item('b', 0.5, 20), item('c', 0.51, 5), item('d', 1.2, 1)];
    expect(redundantVictim(set)?.key).toBe('c');
  });

  it('is never the anchor, and is null for anchors alone or a single item', () => {
    const set = [item('selfie', 0, 1, true), item('copy', 0.001, 999), item('far', 1, 2)];
    expect(redundantVictim(set)?.key).toBe('copy');
    expect(redundantVictim([item('s1', 0, 1, true), item('s2', 0, 2, true)])).toBeNull();
    expect(redundantVictim([item('only', 0, 1)])).toBeNull();
  });

  it('ranks an unknown capture date oldest', () => {
    expect(redundantVictim([item('dated', 0, 1), item('undated', 0.01, null)])?.key).toBe(
      'undated'
    );
  });
});

describe('decideLearning: what a confirmed face does', () => {
  const CAP = 4;
  const held = [item('r0', 0, 10), item('r1', 0.4, 20), item('r2', 0.8, 30)];

  it('never learns past the auto distance of a held reference (anti-drift)', () => {
    // 0.55 from the nearest reference: shown, confirmed, never learned.
    const lookalike = item('look', 0.8 + angleOf(0.55), 1000);
    expect(decideLearning(held, lookalike, CAP)).toEqual({ kind: 'skip', reason: 'too_far' });
    expect(decideLearning([], item('x', 0, 1), CAP)).toEqual({
      kind: 'skip',
      reason: 'no_references',
    });
  });

  it('adds below the cap, and at the cap replaces the older of the closest pair', () => {
    expect(decideLearning(held, item('new', 1.0, 40), CAP)).toEqual({ kind: 'add' });
    const full = [...held, item('r3', 1.2, 35)];
    // 'new' at 1.19 duplicates r3, and is newer: r3 goes.
    expect(decideLearning(full, item('new', 1.19, 40), CAP)).toEqual({
      kind: 'replace',
      victim: 'r3',
    });
  });

  it('does not learn an OLD photo that duplicates a newer reference', () => {
    const full = [...held, item('r3', 1.2, 35)];
    expect(decideLearning(full, item('old', 1.19, 1), CAP)).toEqual({
      kind: 'skip',
      reason: 'redundant',
    });
  });

  it('moves the references towards newer photos over a sequence, never to a lookalike', () => {
    const cap = 15;
    // A member's references from their first year: fifteen faces spread over [-0.3, 0.3].
    let refs: ReferenceItem[] = Array.from({ length: cap }, (_, i) =>
      item(`y1-${i}`, -0.3 + (0.6 * i) / (cap - 1), i)
    );
    const confirmations = 40;
    // Their face over the next years: it has moved (now spread over [0, 0.6], half of it overlapping
    // the first year), and the photos come in no particular order of angle, later in time.
    const angles = shuffled(
      Array.from({ length: confirmations }, (_, j) => (0.6 * j) / (confirmations - 1)),
      7
    );
    for (let k = 1; k <= confirmations; k++) {
      const face = item(`y2-${k}`, angles[k - 1], 100 + k);
      const decision = decideLearning(refs, face, cap);
      if (decision.kind === 'add') refs = [...refs, face];
      if (decision.kind === 'replace')
        refs = [...refs.filter((r) => r.key !== decision.victim), face];
      // A lookalike confirmed at the same time, 0.55 past the newest reference: never learned.
      const reach = Math.max(...refs.map((r) => Math.atan2(r.embedding[1], r.embedding[0])));
      const lookalike = item(`look-${k}`, reach + angleOf(0.55), 100 + k);
      expect(decideLearning(refs, lookalike, cap)).toEqual({ kind: 'skip', reason: 'too_far' });
      expect(refs).toHaveLength(cap);
    }
    const recent = refs.filter((r) => r.key.startsWith('y2-')).length;
    expect(recent).toBeGreaterThan(cap / 2);
    // Where the two years overlap, the older photos went; the region only the first year covers
    // keeps its references: variety is kept, never traded for recency.
    const angle = (r: ReferenceItem) => Math.atan2(r.embedding[1], r.embedding[0]);
    expect(refs.filter((r) => r.key.startsWith('y1-') && angle(r) > 0.05)).toHaveLength(0);
    expect(refs.some((r) => r.key.startsWith('y1-') && angle(r) < -0.2)).toBe(true);
    // Never a lookalike.
    expect(refs.some((r) => r.key.startsWith('look-'))).toBe(false);
  });
});

describe('negatives: "not me" withholds a lookalike from that member only', () => {
  const alice = { userId: 'alice', refs: [at(0)], negatives: [at(1.1)] };
  const bob = { userId: 'bob', refs: [at(1.0)] };

  it('withholds a face nearer one of their negatives than their nearest reference', () => {
    const face = at(1.05);
    const d = cosineDistance(alice.refs[0], face);
    expect(d).toBeLessThan(0.62);
    expect(withheldByNegative(alice, face, d)).toBe(true);
    // Nearer the reference than the negative: offered.
    const own = at(0.3);
    expect(withheldByNegative(alice, own, cosineDistance(alice.refs[0], own))).toBe(false);
  });

  it('is not consulted past the suggested band, and a broken negative withholds and reports', () => {
    expect(withheldByNegative(alice, at(1.1), 0.63)).toBe(false);
    let reported = 0;
    const broken = { userId: 'x', refs: [at(0)], negatives: [Float32Array.from([Number.NaN, 0])] };
    expect(withheldByNegative(broken, at(0.5), 0.2, () => reported++)).toBe(true);
    expect(reported).toBe(1);
  });

  it("never touches another member's decision", () => {
    // Alice's lookalike goes to bob, the one it is; alice is still his runner-up.
    const face = at(1.08);
    const decision = decideFace(face, [alice, bob]);
    expect(decision?.userId).toBe('bob');
    expect(decision?.runnerUp).toBeCloseTo(cosineDistance(alice.refs[0], face), 6);
    // Without bob, alice is not offered it at all.
    expect(decideFace(face, [alice])).toBeNull();
    // Bob holds no negative of alice's: a face near alice's negative still goes to him alone.
    expect(decideFace(at(1.1), [bob])?.userId).toBe('bob');
  });
});

describe('the confirmation list: optimistic removal, rollback in place', () => {
  const list: Suggestion[] = [
    { asset_id: 'a', face_index: 0 },
    { asset_id: 'b', face_index: 1 },
    { asset_id: 'c', face_index: 0 },
  ];

  it('removes answered faces by key', () => {
    expect(removeKeys(list, ['b:1', 'c:0'])).toEqual([{ asset_id: 'a', face_index: 0 }]);
    expect(removeKeys(list, ['b:0'])).toEqual(list);
  });

  it('puts a refused answer back where it was, never twice', () => {
    const without = removeKeys(list, ['b:1']);
    expect(restoreAt(without, list[1], 1)).toEqual(list);
    // The list got shorter meanwhile: at the end.
    expect(restoreAt([], list[1], 1)).toEqual([list[1]]);
    expect(restoreAt(list, list[1], 0)).toEqual(list);
  });
});

describe('growUntilStable (the bootstrap, owner 2026-11-01: "jusqu\'à stabiliser")', () => {
  const within = (_c: ReferenceItem, d: number) => d <= 0.4;

  it('reaches a face only a previous round made reachable, and stops at the drift guard', () => {
    const selfie = item('selfie', 0, null, true);
    const step = angleOf(0.2);
    // A is 0.1 from the selfie, B 0.2 beyond A (0.54 from the selfie, so out of reach at the start),
    // C 0.2 beyond B (past 0.62 from the selfie: the guard, though 0.2 from B).
    const a = item('a', angleOf(0.1), null);
    const b = item('b', angleOf(0.1) + step, null);
    const c = item('c', angleOf(0.1) + 2 * step, null);
    expect(cosineDistance(selfie.embedding, b.embedding)).toBeGreaterThan(0.4);
    expect(cosineDistance(selfie.embedding, b.embedding)).toBeLessThanOrEqual(0.62);
    expect(cosineDistance(selfie.embedding, c.embedding)).toBeGreaterThan(0.62);
    const added = growUntilStable([selfie], [c, b, a], 15, within);
    expect(added.map((x) => x.key)).toEqual(['a', 'b']);
  });

  it('holds the bound on every candidate and never drops a held reference', () => {
    const selfie = item('selfie', 0, null, true);
    const far = item('far', angleOf(0.45), null);
    expect(growUntilStable([selfie], [far], 15, within)).toEqual([]);
    expect(growUntilStable([selfie], [], 15, within)).toEqual([]);
  });

  it('stops at the cap, whatever is left to take', () => {
    const held = Array.from({ length: 14 }, (_, i) => item(`h${i}`, i * 0.001, null, i === 0));
    const near = Array.from({ length: 5 }, (_, i) => item(`n${i}`, angleOf(0.05) + i * 0.01, null));
    const added = growUntilStable(held, near, 15, within);
    expect(added).toHaveLength(1);
  });

  it('gives the same set whatever the order of the candidates', () => {
    const selfie = item('selfie', 0, null, true);
    const cands = Array.from({ length: 12 }, (_, i) =>
      item(`c${i}`, angleOf(0.02 + i * 0.03), i * 1000)
    );
    const keys = (list: readonly ReferenceItem[]) =>
      growUntilStable([selfie], list, 15, within).map((x) => x.key);
    expect(keys(shuffled(cands, 7))).toEqual(keys(cands));
  });
});
