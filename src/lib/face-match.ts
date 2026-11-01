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
 *   closer than FACE_AMBIGUITY_MARGIN (strictly), or when the member holds fewer than
 *   FACE_MIN_REFERENCES references: a lookalike or a thin enrolment always goes past a human.
 * - A member who REJECTED the face is never offered it, but still counts as the runner-up: a face
 *   one member rejected at 0.20 is a lookalike case for the next one at 0.40, never `auto`.
 * - Above FACE_SUGGEST_MAX_DISTANCE, nobody.
 * - A member's NEGATIVES (faces they answered "not me" on, owner 2026-11-01): a face closer to one
 *   of them than to the member's nearest reference is not offered to that member, exactly as if
 *   they had rejected it - still the runner-up, so it never goes `auto` to the next member on their
 *   account. A member's negatives decide only whether THAT member is offered a face: they never
 *   move another member's distance, so rejecting one's own faces only hurts oneself.
 */

import {
  FACE_AMBIGUITY_MARGIN,
  FACE_MIN_REFERENCES,
  FACE_SUGGEST_MAX_DISTANCE,
  classifyDistance,
  minDistance,
  type FaceBand,
} from '#lib/face-embedding.ts';

/** One enrolled member, their opened references and negatives. Biometric: never serialised. */
export interface MemberReferences {
  userId: string;
  refs: ReadonlyArray<ArrayLike<number>>;
  /** Faces they answered "not me" on (face_negatives), opened. */
  negatives?: ReadonlyArray<ArrayLike<number>>;
}

/**
 * Whether the member's own negatives withhold a face from them: it lies closer (strictly) to one of
 * their negatives than to their nearest reference, `d`. Only asked within the suggested band:
 * beyond it they are not offered the face anyway. A corrupt negative (NaN) withholds it - the safe
 * side for that member alone - and is reported.
 */
export function withheldByNegative(
  member: MemberReferences,
  candidate: ArrayLike<number>,
  d: number,
  onInvalid?: () => void
): boolean {
  if (!member.negatives || member.negatives.length === 0 || d > FACE_SUGGEST_MAX_DISTANCE) {
    return false;
  }
  const nearestNegative = minDistance(member.negatives, candidate);
  if (Number.isNaN(nearestNegative)) {
    onInvalid?.();
    return true;
  }
  return nearestNegative < d;
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

/** Where {@link decideFace} reports what it could not use (this module has no logger). */
export interface DecideReports {
  /** A member's reference is not a usable vector: the member is skipped for this face. */
  invalidReference?: (userId: string) => void;
  /** The face itself is not a usable vector: nobody is matched, reported ONCE. */
  invalidCandidate?: () => void;
  /** A member's negative is not a usable vector: the face is withheld from that member. */
  invalidNegative?: (userId: string) => void;
}

/** Whether every component of a vector is a finite number. */
function finiteVector(v: ArrayLike<number>): boolean {
  for (let i = 0; i < v.length; i++) {
    if (!Number.isFinite(v[i])) {
      return false;
    }
  }
  return v.length > 0;
}

/**
 * The decision for one face against every member. `excluded` are members who must not be offered
 * it (they rejected it), and so is a member whose negatives withhold it ({@link withheldByNegative});
 * both still count as the runner-up. A face that is not a usable vector
 * matches nobody and is reported once as the face's fault; a member whose distance is NaN (a
 * corrupt reference) is skipped and reported, never matched.
 */
export function decideFace(
  candidate: ArrayLike<number>,
  members: ReadonlyArray<MemberReferences>,
  excluded?: ReadonlySet<string>,
  reports?: DecideReports
): FaceDecision | null {
  if (!finiteVector(candidate)) {
    reports?.invalidCandidate?.();
    return null;
  }
  let best: MemberReferences | null = null;
  let bestD = Infinity;
  let second = Infinity;
  /** The nearest member who rejected the face: never offered it, but a runner-up all the same. */
  let nearestExcluded = Infinity;
  for (const member of members) {
    if (member.refs.length === 0) {
      continue;
    }
    const d = minDistance(member.refs, candidate);
    if (Number.isNaN(d)) {
      reports?.invalidReference?.(member.userId);
      continue;
    }
    if (
      excluded?.has(member.userId) ||
      withheldByNegative(member, candidate, d, () => reports?.invalidNegative?.(member.userId))
    ) {
      nearestExcluded = Math.min(nearestExcluded, d);
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
  const nearestOther = Math.min(second, nearestExcluded);
  const runnerUp = Number.isFinite(nearestOther) ? nearestOther : null;
  const band = decideBand(bestD, runnerUp, best.refs.length);
  if (band === 'none') {
    return null;
  }
  return { userId: best.userId, distance: bestD, runnerUp, band };
}
