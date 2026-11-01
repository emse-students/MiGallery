/**
 * How a DEFAULT profile photo is ranked among a member's own photos (owner, 2026-11-01,
 * docs/wiki/face-matching-option-c.md, "The default profile photo"). Pure, so every rule is tested
 * on its own; profile-photo-default.ts gathers the facts and applies it.
 *
 * THE ORDER, each key deciding only between candidates equal on every key before it:
 * 1. a face the member CONFIRMED before one only shown (`auto`): a human said it is them;
 * 2. CLOSENESS to their references, by steps of {@link DISTANCE_STEP} (nearer first): a recognisable
 *    face. Steps, not the raw distance, so the keys below still matter between two faces the
 *    matcher sees as equally theirs;
 * 3. the face's SIZE in the frame (box area over image area, larger first): a sharp avatar;
 * 4. the detector's SCORE (higher first; a face seeded from Immich has none and ranks after);
 * 5. a SINGLE-FACE photo before a group photo;
 * 6. the more RECENT capture date (unknown last);
 * 7. the asset id, then the face index: a fixed tie-break, so the choice never depends on order.
 */

/** One visible face of the member, with what the ranking reads. */
export interface ProfileCandidate {
  assetId: string;
  faceIndex: number;
  confirmed: boolean;
  /** Cosine distance to their references at the face's decision. */
  distance: number;
  /** Box area over image area, 0 to 1. */
  areaRatio: number;
  /** The detector's score, null for a seeded face. */
  score: number | null;
  /** How many faces the store holds on that photo. */
  facesOnPhoto: number;
  /** Capture date (ms), null when unknown. */
  takenAt: number | null;
}

/** The width of a closeness step. */
export const DISTANCE_STEP = 0.05;

// The epsilon keeps 0.3 in the step [0.30, 0.35): 0.3 / 0.05 is 5.999... in binary.
const step = (d: number) => (Number.isFinite(d) ? Math.floor(d / DISTANCE_STEP + 1e-9) : Infinity);

/** Best first; a total order (see the module header for the keys). */
export function compareProfileCandidates(a: ProfileCandidate, b: ProfileCandidate): number {
  if (a.confirmed !== b.confirmed) {
    return a.confirmed ? -1 : 1;
  }
  if (step(a.distance) !== step(b.distance)) {
    return step(a.distance) - step(b.distance);
  }
  if (a.areaRatio !== b.areaRatio) {
    return b.areaRatio - a.areaRatio;
  }
  const sa = a.score ?? -Infinity;
  const sb = b.score ?? -Infinity;
  if (sa !== sb) {
    return sb > sa ? 1 : -1;
  }
  const soloA = a.facesOnPhoto <= 1;
  const soloB = b.facesOnPhoto <= 1;
  if (soloA !== soloB) {
    return soloA ? -1 : 1;
  }
  const ta = a.takenAt ?? -Infinity;
  const tb = b.takenAt ?? -Infinity;
  if (ta !== tb) {
    return tb > ta ? 1 : -1;
  }
  if (a.assetId !== b.assetId) {
    return a.assetId < b.assetId ? -1 : 1;
  }
  return a.faceIndex - b.faceIndex;
}

/** The candidates, best first. */
export function rankProfileCandidates(list: readonly ProfileCandidate[]): ProfileCandidate[] {
  return [...list].sort(compareProfileCandidates);
}

/** A face box as Immich and the store keep it: corners in the frame `imgW` x `imgH`. */
export interface Box {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  imgW: number;
  imgH: number;
}

/**
 * Overlap of two boxes, each scaled to its own frame first (0 to 1): how the face Immich featured
 * is found among the faces the store holds on that photo, whose frames may differ.
 */
export function boxOverlap(a: Box, b: Box): number {
  const n = (box: Box) => ({
    x1: box.x1 / box.imgW,
    y1: box.y1 / box.imgH,
    x2: box.x2 / box.imgW,
    y2: box.y2 / box.imgH,
  });
  if (!(a.imgW > 0 && a.imgH > 0 && b.imgW > 0 && b.imgH > 0)) {
    return 0;
  }
  const p = n(a);
  const q = n(b);
  const w = Math.min(p.x2, q.x2) - Math.max(p.x1, q.x1);
  const h = Math.min(p.y2, q.y2) - Math.max(p.y1, q.y1);
  if (w <= 0 || h <= 0) {
    return 0;
  }
  const inter = w * h;
  const union = (p.x2 - p.x1) * (p.y2 - p.y1) + (q.x2 - q.x1) * (q.y2 - q.y1) - inter;
  return union > 0 ? inter / union : 0;
}

/** The overlap at or above which a stored face IS the face Immich featured. */
export const FEATURED_MIN_OVERLAP = 0.5;
