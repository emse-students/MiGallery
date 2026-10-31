/**
 * The matcher's decision (lot A2, docs/wiki/face-matching-option-c.md): which member, if any, a
 * stored face belongs to, and in which band. Pure functions: every path that decides a face -
 * a new photo, an enrolment, a withdrawal, the seed - calls {@link decideFace}, so the store's
 * state is the same whatever order the events came in.
 *
 * THE RULES.
 * - A member's distance to a face is the MINIMUM cosine distance to their references.
 * - Only the NEAREST member is ever offered the face: a face is never shown to two people.
 * - `auto` (<= FACE_AUTO_MAX_DISTANCE) is downgraded to `suggested` when the runner-up member is
 *   within FACE_AMBIGUITY_MARGIN, or when the member holds fewer than FACE_MIN_REFERENCES
 *   references: a lookalike or a thin enrolment always goes past a human.
 * - Above FACE_SUGGEST_MAX_DISTANCE, nobody.
 */

import {
  FACE_AMBIGUITY_MARGIN,
  FACE_MIN_REFERENCES,
  classifyDistance,
  minDistance,
  type FaceBand,
} from '#lib/face-embedding.ts';

/** One enrolled member and their opened references. Biometric: never serialised. */
export interface MemberReferences {
  userId: string;
  refs: ReadonlyArray<ArrayLike<number>>;
}

/** Who a face goes to. `runnerUp` is the next member's distance (null: there is none). */
export interface FaceDecision {
  userId: string;
  distance: number;
  runnerUp: number | null;
  band: Exclude<FaceBand, 'none'>;
}

/** The band a member's distance earns, given the runner-up and the member's reference count. */
export function decideBand(
  distance: number,
  runnerUp: number | null,
  referenceCount: number
): FaceBand {
  const band = classifyDistance(distance);
  if (band !== 'auto') {
    return band;
  }
  if (referenceCount < FACE_MIN_REFERENCES) {
    return 'suggested';
  }
  if (runnerUp !== null && runnerUp - distance < FACE_AMBIGUITY_MARGIN) {
    return 'suggested';
  }
  return 'auto';
}

/**
 * The decision for one face against every member. `excluded` are members who must not be offered
 * it (they rejected it). A member whose distance is NaN (a corrupt reference) is skipped and
 * reported through `onInvalid`, never matched.
 */
export function decideFace(
  candidate: ArrayLike<number>,
  members: ReadonlyArray<MemberReferences>,
  excluded?: ReadonlySet<string>,
  onInvalid?: (userId: string) => void
): FaceDecision | null {
  let best: MemberReferences | null = null;
  let bestD = Infinity;
  let second = Infinity;
  for (const member of members) {
    if (member.refs.length === 0 || excluded?.has(member.userId)) {
      continue;
    }
    const d = minDistance(member.refs, candidate);
    if (Number.isNaN(d)) {
      onInvalid?.(member.userId);
      continue;
    }
    if (d < bestD) {
      second = bestD;
      bestD = d;
      best = member;
    } else if (d < second) {
      second = d;
    }
  }
  if (!best) {
    return null;
  }
  const runnerUp = Number.isFinite(second) ? second : null;
  const band = decideBand(bestD, runnerUp, best.refs.length);
  if (band === 'none') {
    return null;
  }
  return { userId: best.userId, distance: bestD, runnerUp, band };
}
