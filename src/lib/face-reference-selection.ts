/**
 * Which faces a member's references are, and which one a new face replaces (faces v2, the owner's
 * decisions of 2026-11-01, docs/wiki/face-matching-option-c.md). Pure functions over opened
 * vectors: no database, no clock, no logger, so every rule here is tested on its own.
 *
 * VARIETY, NOT CENTRALITY. The A7 seed took the faces nearest the centroid of a member's old
 * Immich person: near-identical frontal faces, so a profile, a coloured light or a costume fell
 * into the 0.5-0.62 band and was asked about. {@link selectVariedReferences} instead covers the
 * member's face space: farthest-point sampling, each new reference the candidate FARTHEST from
 * those already chosen.
 *
 * FARTHEST-POINT PICKS OUTLIERS, SO THE POOL IS WHAT KEEPS IT HONEST. Among faces of the member,
 * the farthest is a real angle or light; among faces that include a stranger, it is the stranger.
 * So the pool a caller hands in holds PROVEN faces only (face-reference-upgrade.ts says which),
 * and {@link learnable} - within the `auto` distance of a reference the member ALREADY holds -
 * bounds every one of them: the reach grows by at most 0.5 per step, and only through an answer.
 *
 * RENEWAL TRACKS THE FACE OVER TIME, FROM DATA ON THE PHOTO. Once at the cap, a new face may
 * replace the LEAST USEFUL reference ({@link redundantVictim}): of the two closest references, the
 * older by the photo's CAPTURE date. So variety is kept (a redundant pair loses one) and the set
 * drifts towards recent photos (the older of the pair goes) - never by a timer.
 */

import { FACE_AUTO_MAX_DISTANCE, cosineDistance, minDistance } from '#lib/face-embedding.ts';

/** One reference, held or candidate. Biometric: never serialised. */
export interface ReferenceItem {
  /** Unique and stable: every tie is broken on it, so a selection never depends on input order. */
  key: string;
  embedding: ArrayLike<number>;
  /** The capture date of the photo it came from (ms), or null when unknown (ranks oldest). */
  takenAt: number | null;
  /** The member's selfie: chosen first, never replaced by renewal. */
  anchor?: boolean;
}

/**
 * Whether a face may become a reference: its distance to the member's NEAREST reference is within
 * the `auto` band, the matcher's own bound (inclusive, as `classifyDistance`). NaN never is.
 */
export function learnable(nearestReferenceDistance: number): boolean {
  return nearestReferenceDistance <= FACE_AUTO_MAX_DISTANCE;
}

/** Whether a vector can be compared at all: finite, and not all zeros. */
export function usableVector(v: ArrayLike<number>): boolean {
  let norm = 0;
  for (let i = 0; i < v.length; i++) {
    if (!Number.isFinite(v[i])) {
      return false;
    }
    norm += v[i] * v[i];
  }
  return norm > 0;
}

/** Newer first: capture date descending (unknown last), then key ascending. A total order. */
export function compareRecency(a: ReferenceItem, b: ReferenceItem): number {
  const ta = a.takenAt ?? -Infinity;
  const tb = b.takenAt ?? -Infinity;
  if (ta !== tb) {
    return ta > tb ? -1 : 1;
  }
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/**
 * Up to `cap` references chosen from `pool` for VARIETY: the anchors first (the selfie), else the
 * most recent face; then, repeatedly, the face farthest from every one already chosen (ties: the
 * more recent, then the key). A face that is not a usable vector is never chosen. Deterministic:
 * the same pool in any order gives the same set, in the same order.
 */
export function selectVariedReferences(
  pool: ReadonlyArray<ReferenceItem>,
  cap: number
): ReferenceItem[] {
  const usable = pool.filter((item) => usableVector(item.embedding)).sort(compareRecency);
  const selected: ReferenceItem[] = usable.filter((item) => item.anchor).slice(0, cap);
  const rest = usable.filter((item) => !item.anchor);
  if (selected.length === 0 && rest.length > 0 && cap > 0) {
    selected.push(rest.shift() as ReferenceItem);
  }
  // Distance of each remaining face to the nearest chosen one, kept up to date as faces are added.
  const nearest = rest.map((item) =>
    selected.length > 0
      ? minDistance(
          selected.map((s) => s.embedding),
          item.embedding
        )
      : Infinity
  );
  const taken = Array.from({ length: rest.length }, () => false);
  while (selected.length < cap) {
    let best = -1;
    for (let i = 0; i < rest.length; i++) {
      // `rest` is sorted newer first, so a strict `>` keeps the more recent face on a tie.
      if (!taken[i] && (best < 0 || nearest[i] > nearest[best])) {
        best = i;
      }
    }
    if (best < 0) {
      break;
    }
    taken[best] = true;
    selected.push(rest[best]);
    for (let i = 0; i < rest.length; i++) {
      if (!taken[i]) {
        nearest[i] = Math.min(nearest[i], cosineDistance(rest[best].embedding, rest[i].embedding));
      }
    }
  }
  return selected;
}

/**
 * The LEAST USEFUL member of a set, the one renewal drops: of the CLOSEST pair (the two that
 * duplicate each other most; a pair of two anchors never counts), the one that is not an anchor,
 * and of two that are not, the OLDER by capture date. Ties on the distance go to the pair whose
 * keys sort first. Null when no pair can lose one (fewer than two items, or anchors only).
 */
export function redundantVictim(items: ReadonlyArray<ReferenceItem>): ReferenceItem | null {
  let pair: [ReferenceItem, ReferenceItem] | null = null;
  let pairD = Infinity;
  let pairKey = '';
  const set = items.filter((item) => usableVector(item.embedding));
  for (let i = 0; i < set.length; i++) {
    for (let j = i + 1; j < set.length; j++) {
      const a = set[i];
      const b = set[j];
      if (a.anchor && b.anchor) {
        continue;
      }
      const d = cosineDistance(a.embedding, b.embedding);
      if (Number.isNaN(d)) {
        continue;
      }
      const key = [a.key, b.key].sort().join('\u0000');
      if (d < pairD || (d === pairD && key < pairKey)) {
        pair = [a, b];
        pairD = d;
        pairKey = key;
      }
    }
  }
  if (!pair) {
    return null;
  }
  const [a, b] = pair;
  if (a.anchor) {
    return b;
  }
  if (b.anchor) {
    return a;
  }
  // The older of the two: the one that sorts LAST newer-first.
  return compareRecency(a, b) > 0 ? a : b;
}

/** What a confirmed face does to the member's references. */
export type LearnDecision =
  | { kind: 'add' }
  | { kind: 'replace'; victim: string }
  | { kind: 'skip'; reason: 'no_references' | 'too_far' | 'redundant' };

/**
 * Whether `incoming` (a face the member just confirmed) becomes a reference, and in place of
 * which. Never beyond {@link learnable} of what they hold (`too_far`); below the cap it is added;
 * at the cap it replaces the {@link redundantVictim} of the held set plus itself - unless that
 * victim is the incoming face itself (an old photo, or a duplicate of a newer reference), which
 * changes nothing (`redundant`).
 */
export function decideLearning(
  held: ReadonlyArray<ReferenceItem>,
  incoming: ReferenceItem,
  cap: number
): LearnDecision {
  if (held.length === 0) {
    return { kind: 'skip', reason: 'no_references' };
  }
  const nearest = minDistance(
    held.map((h) => h.embedding),
    incoming.embedding
  );
  if (!learnable(nearest)) {
    return { kind: 'skip', reason: 'too_far' };
  }
  if (held.length < cap) {
    return { kind: 'add' };
  }
  const victim = redundantVictim([...held, incoming]);
  if (!victim || victim.key === incoming.key) {
    return { kind: 'skip', reason: 'redundant' };
  }
  return { kind: 'replace', victim: victim.key };
}
