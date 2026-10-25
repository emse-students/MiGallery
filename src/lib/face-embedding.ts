/**
 * Face embeddings, option C (docs/wiki/face-store.md): the float16 codec, the cosine distance and
 * the thresholds. Pure functions, no I/O, safe on the client and the server.
 *
 * Why float16: a 512-d vector is 1 KB, so 600k stored faces are about 0.6 GB instead of 1.2 GB.
 * The recall cost of the quantisation is NOT MEASURED yet (docs/wiki/face-store.md, "owed").
 */

/** The only model whose embeddings are stored and compared. Every stored vector carries its tag. */
export const FACE_MODEL = 'buffalo_l';

/** Length of one embedding. */
export const FACE_EMBEDDING_DIM = 512;

/** Reference embeddings per member: at least this many are wanted, never more than the cap. */
export const FACE_MIN_REFERENCES = 3;
/** The cap. schema.sql holds the same number in `trg_face_references_cap` (a test pins both). */
export const FACE_MAX_REFERENCES = 5;

/** Cosine distance up to which a face is accepted without a human (Immich's own value). */
export const FACE_AUTO_MAX_DISTANCE = 0.5;
/**
 * Cosine distance up to which a face is OFFERED to the member for confirmation (buffalo_l, about
 * 1e-4 false match per pair on a 75k-pair sample: optimistic, so the band needs a human).
 */
export const FACE_SUGGEST_MAX_DISTANCE = 0.62;

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
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Float32Array(FACE_EMBEDDING_DIM);
  for (let i = 0; i < out.length; i++) {
    out[i] = halfToFloat(view.getUint16(i * 2, true));
  }
  return out;
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
  // Rounding leaves 1 - dot/norm at about -5e-15 for identical or parallel vectors; a distance is
  // never negative, and classifyDistance would send a negative to 'none'. A NaN stays a NaN.
  return Math.min(2, Math.max(0, 1 - dot / Math.sqrt(na * nb)));
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
