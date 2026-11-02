/**
 * Face embeddings, option C (docs/wiki/face-matching-option-c.md): the float16 codec, the cosine distance and
 * the thresholds. Pure functions, no I/O, safe on the client and the server.
 *
 * Why float16: a 512-d vector is 1 KB, so 600k stored faces are about 0.6 GB instead of 1.2 GB.
 * Measured against float32 on the members' own links: of about 14.5 million member-face
 * distances, ONE changed band (largest difference 7.8e-5; docs/wiki/face-matching-option-c.md,
 * section 2.2).
 */

/** The only model whose embeddings are stored and compared. Every stored vector carries its tag. */
export const FACE_MODEL = 'buffalo_l';

/** Length of one embedding. */
export const FACE_EMBEDDING_DIM = 512;

/** Reference embeddings per member: at least this many are wanted, never more than the cap. */
export const FACE_MIN_REFERENCES = 3;
/**
 * The cap (owner, 2026-11-01: up to 15, chosen for VARIETY, docs/wiki/face-matching-option-c.md
 * "The decided numbers"). schema.sql holds the same number in `trg_face_references_cap` (a test pins both).
 * The matcher's cost grows linearly in it: every face it decides is compared with every reference
 * of every member.
 */
export const FACE_MAX_REFERENCES = 15;

/** References the one-shot A7 seed took per linked member (the faces nearest their centroid). */
export const FACE_SEED_REFERENCES = 5;

/**
 * Negative examples kept per member (a face they answered "not me" on). schema.sql holds the same
 * number in `trg_face_negatives_cap` (a test pins both).
 */
export const FACE_MAX_NEGATIVES = 30;

/**
 * Distance to the member's CURRENT references within which an `auto` face (no human answered it)
 * counts as PROVEN theirs and may become a reference when their references are re-selected. A
 * margin of 0.1 under the `auto` bound: the auto faces most likely to be wrong are the ones nearest
 * that bound, and they never teach.
 */
export const FACE_PROVEN_AUTO_DISTANCE = 0.4;

/**
 * The version of the reference selection a member's references were last chosen by
 * (`face_reference_selection`). 2: up to 15 varied references from the proven faces (2026-11-01).
 * 3: a member below FACE_MIN_REFERENCES also learns from the `suggested` faces nearest their
 * selfie (the bootstrap, face-reference-upgrade.ts); a member already at the minimum is only
 * marked. A member below it is re-selected once, in the background.
 */
export const FACE_REFERENCE_SELECTION_VERSION = 3;

/**
 * The selection marker of a member whose pass an admin UNDID (face-reference-ledger.ts): never
 * selected again by the tick, and cleared when they enrol with a new selfie.
 */
export const FACE_SELECTION_UNDONE = -1;

/** Cosine distance up to which a face is accepted without a human (Immich's own value). */
export const FACE_AUTO_MAX_DISTANCE = 0.5;
/**
 * Cosine distance up to which a face is OFFERED to the member for confirmation (buffalo_l, about
 * 1e-4 false match per pair on a 75k-pair sample: optimistic, so the band needs a human).
 */
export const FACE_SUGGEST_MAX_DISTANCE = 0.62;

/**
 * Margin under which the runner-up member makes a face ambiguous: an `auto` face whose next member
 * is closer than this to it (strictly) is only `suggested`. Measured on the members' own links: no `auto` face
 * had a runner-up within 0.05 (docs/wiki/face-matching-option-c.md, section 2.2).
 */
export const FACE_AMBIGUITY_MARGIN = 0.05;

/** Detector score a face needs to be stored, and a selfie's one face to become a reference. */
export const FACE_DETECTION_MIN_SCORE = 0.7;

/**
 * The floor a selfie is searched at for OTHER faces: any second face at or above it refuses the
 * selfie, so a half-visible bystander can never become a member's reference.
 */
export const FACE_SELFIE_BYSTANDER_SCORE = 0.5;

/** What a distance means: `auto` is accepted, `suggested` needs the member's confirmation. */
export type FaceBand = 'auto' | 'suggested' | 'none';

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);

/** Round a number to the nearest IEEE-754 half (ties to even), as its 16 bits. */
export function floatToHalf(value: number): number {
  f32[0] = value;
  const x = u32[0];
  const sign = (x >>> 16) & 0x8000;
  const exp = (x >>> 23) & 0xff;
  const mant = x & 0x7fffff;
  if (exp === 0xff) {
    return sign | 0x7c00 | (mant ? 0x200 : 0); // inf or NaN
  }
  const e = exp - 127 + 15;
  if (e >= 0x1f) {
    return sign | 0x7c00; // overflow to infinity
  }
  if (e <= 0) {
    if (e < -10) {
      return sign; // underflow to zero
    }
    const m = mant | 0x800000;
    const shift = 14 - e;
    let half = m >>> shift;
    const rest = m & ((1 << shift) - 1);
    const mid = 1 << (shift - 1);
    if (rest > mid || (rest === mid && half & 1)) {
      half += 1;
    }
    return sign | half;
  }
  let half = sign | (e << 10) | (mant >>> 13);
  const rest = mant & 0x1fff;
  if (rest > 0x1000 || (rest === 0x1000 && half & 1)) {
    half += 1; // a carry out of the mantissa correctly bumps the exponent
  }
  return half;
}

/** The number a half (16 bits) stands for. */
export function halfToFloat(half: number): number {
  const sign = half & 0x8000 ? -1 : 1;
  const exp = (half >>> 10) & 0x1f;
  const mant = half & 0x3ff;
  if (exp === 0) {
    return sign * mant * 2 ** -24;
  }
  if (exp === 0x1f) {
    return mant ? NaN : sign * Infinity;
  }
  return sign * (1 + mant / 1024) * 2 ** (exp - 15);
}

/**
 * Scale a vector to unit length (cosine distance then is one minus a dot product). Throws on a
 * wrong length or a zero or non-finite vector: a template that cannot be compared must never be
 * stored as if it could.
 */
export function normalizeEmbedding(vector: ArrayLike<number>): Float32Array {
  if (vector.length !== FACE_EMBEDDING_DIM) {
    throw new Error(`embedding has ${vector.length} dimensions, expected ${FACE_EMBEDDING_DIM}`);
  }
  let sum = 0;
  for (let i = 0; i < vector.length; i++) {
    if (!Number.isFinite(vector[i])) {
      throw new Error('embedding holds a non-finite value');
    }
    sum += vector[i] * vector[i];
  }
  if (sum === 0) {
    throw new Error('embedding is the zero vector');
  }
  const norm = Math.sqrt(sum);
  const out = new Float32Array(vector.length);
  for (let i = 0; i < vector.length; i++) {
    out[i] = vector[i] / norm;
  }
  return out;
}

/** Pack a (normalised) embedding as 512 little-endian halves, 1024 bytes. */
export function encodeEmbedding(vector: ArrayLike<number>): Uint8Array {
  const unit = normalizeEmbedding(vector);
  const out = new Uint8Array(FACE_EMBEDDING_DIM * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < unit.length; i++) {
    view.setUint16(i * 2, floatToHalf(unit[i]), true);
  }
  return out;
}

/** Unpack {@link encodeEmbedding}'s bytes back to floats. Throws on a wrong length. */
export function decodeEmbedding(bytes: Uint8Array): Float32Array {
  if (bytes.length !== FACE_EMBEDDING_DIM * 2) {
    throw new Error(
      `encoded embedding has ${bytes.length} bytes, expected ${FACE_EMBEDDING_DIM * 2}`
    );
  }
  const lut = halfTable();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Float32Array(FACE_EMBEDDING_DIM);
  for (let i = 0; i < out.length; i++) {
    out[i] = lut[view.getUint16(i * 2, true)];
  }
  return out;
}

let halfLut: Float32Array | null = null;

/**
 * Every half's value, built once (256 KB): a store scan decodes hundreds of thousands of vectors.
 * Measured 2026-10-31 on 50,000 vectors: 66-135 ms through the table against 597-816 ms through
 * {@link halfToFloat}, from which it is built (docs/wiki/face-matching-option-c.md, A2).
 */
function halfTable(): Float32Array {
  if (!halfLut) {
    halfLut = new Float32Array(65536);
    for (let h = 0; h < 65536; h++) {
      halfLut[h] = halfToFloat(h);
    }
  }
  return halfLut;
}

/**
 * Cosine distance (1 - cosine similarity) between two vectors of the same length, normalising
 * both: a half-rounded vector is not exactly unit length and must not skew the figure.
 */
export function cosineDistance(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length) {
    throw new Error(`cannot compare ${a.length} with ${b.length} dimensions`);
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) {
    throw new Error('cannot compare a zero vector');
  }
  // Two sqrt, not sqrt(na * nb): the product underflows to 0 for vectors scaled by ~1e-100.
  const raw = 1 - dot / (Math.sqrt(na) * Math.sqrt(nb));
  if (!Number.isFinite(raw)) {
    return NaN; // never clamp an overflow or underflow into a match
  }
  // Rounding leaves the raw value at about -5e-15 for identical or parallel vectors; a distance is
  // never negative, and classifyDistance would send a negative to 'none'.
  return Math.min(2, Math.max(0, raw));
}

/**
 * The smallest distance from `candidate` to any of the member's references. A NaN distance (a
 * reference or candidate holding a non-finite value) makes the result NaN, which classifyDistance
 * maps to 'none': it fails safe, but `onInvalid` is called with the reference index so the
 * caller can log it (this module is shared with the client and has no logger).
 *
 * It accepts ONE reference: FACE_MIN_REFERENCES is enforced at enrolment (A2/A5), not here.
 */
export function minDistance(
  references: ReadonlyArray<ArrayLike<number>>,
  candidate: ArrayLike<number>,
  onInvalid?: (referenceIndex: number) => void
): number {
  if (references.length === 0) {
    throw new Error('a member with no reference cannot be matched');
  }
  let best = Infinity;
  let invalid = false;
  references.forEach((reference, index) => {
    const d = cosineDistance(reference, candidate);
    if (Number.isNaN(d)) {
      invalid = true;
      onInvalid?.(index);
    }
    best = Math.min(best, d);
  });
  return invalid ? NaN : best;
}

/** Which band a distance falls in. Both bounds are inclusive; only NaN is never a match. */
export function classifyDistance(distance: number): FaceBand {
  if (Number.isNaN(distance)) {
    return 'none'; // never a match
  }
  if (distance <= FACE_AUTO_MAX_DISTANCE) {
    return 'auto';
  }
  return distance <= FACE_SUGGEST_MAX_DISTANCE ? 'suggested' : 'none';
}
