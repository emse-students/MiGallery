/**
 * The client of the face model (lot A2, docs/wiki/face-matching-option-c.md): Immich's
 * machine-learning service, called directly with Immich's own model (buffalo_l), so a vector it
 * returns is comparable with the ones Immich already computed and the store was seeded from.
 *
 * `POST {FACE_ML_URL}/predict`, multipart: `entries` names the task, `image` carries the bytes.
 * The answer lists every face found with its box (pixels of the image sent), its detector score
 * and its 512-d embedding, which the service serialises as a JSON STRING inside the JSON.
 *
 * BIOMETRIC DATA. An embedding is a template: it never reaches a log line, an error message or a
 * response. Only counts, scores and the image size are logged. The image itself lives in this
 * request's memory and nowhere else.
 */

import { env } from '#lib/server/env.ts';
import { createLogger } from '#lib/server/logger.ts';
import {
  FACE_DETECTION_MIN_SCORE,
  FACE_EMBEDDING_DIM,
  FACE_MODEL,
  FACE_SELFIE_BYSTANDER_SCORE,
} from '#lib/face-embedding.ts';

const log = createLogger('face-ml');

/**
 * Deadline of one inference. NOT the 4 s outbound budget: a detection plus embedding measured
 * p95 1.07 s and the worst images several seconds on the 2-CPU service (2026-10-24), and a
 * queue of ingestion calls shares it. A deadline still applies: a service that never answers
 * must fail the call, not hold it.
 */
export const FACE_ML_TIMEOUT_MS = 30_000;

/** One face as the model found it. `embedding` is biometric: never log it, never return it. */
export interface DetectedFace {
  /** Box in pixels of the image that was sent. */
  box: { x1: number; y1: number; x2: number; y2: number };
  /** Detector confidence, 0 to 1. */
  score: number;
  /** The raw 512-d embedding (not normalised: the codec normalises on the way in). */
  embedding: Float32Array;
}

/** Every face of one image, and the size the boxes refer to. */
export interface DetectedImage {
  imageWidth: number;
  imageHeight: number;
  faces: DetectedFace[];
}

/**
 * The service could not answer: unreachable, timed out, or a non-2xx status. A transport failure,
 * so the caller retries later; it says nothing about the image.
 */
export class FaceMlUnavailableError extends Error {
  readonly kind = 'ml_unavailable';
  constructor(
    message: string,
    readonly status: number | null
  ) {
    super(message);
    this.name = 'FaceMlUnavailableError';
  }
}

/** The service answered something this client cannot trust (wrong shape, wrong length, NaN). */
export class FaceMlResponseError extends Error {
  readonly kind = 'ml_bad_response';
  constructor(message: string) {
    super(message);
    this.name = 'FaceMlResponseError';
  }
}

/**
 * The statuses by which the service refuses THE IMAGE it was sent (unreadable, too large, not an
 * image, or the request carrying it malformed): the sender's fault, not the service being down.
 * Every other 4xx (401/403/404/405: a wrong URL or credentials; 408/429: the service is busy) is
 * the service not answering, and stays {@link FaceMlUnavailableError}.
 */
const IMAGE_REFUSED_STATUSES: ReadonlySet<number> = new Set([400, 413, 415, 422]);

/**
 * The service answered, and refused the image itself ({@link IMAGE_REFUSED_STATUSES}): another
 * picture is needed, retrying the same one is pointless. Classified here, at the throw.
 */
export class FaceMlImageRefusedError extends Error {
  readonly kind = 'ml_image_refused';
  constructor(readonly status: number) {
    super(`face model refused the image: ${status}`);
    this.name = 'FaceMlImageRefusedError';
  }
}

/** Why a selfie cannot become a reference: the member is asked for another photo. */
export type SelfieRefusal = 'no_face' | 'several_faces';

/** A selfie that does not hold exactly one confident face. */
export class SelfieRefusedError extends Error {
  readonly kind = 'selfie_refused';
  constructor(
    readonly reason: SelfieRefusal,
    readonly faces: number
  ) {
    super(`selfie refused: ${reason}`);
    this.name = 'SelfieRefusedError';
  }
}

/** The service's base URL, or a typed failure when it is not configured. */
function mlBase(): string {
  const base = env.FACE_ML_URL?.replace(/\/$/, '');
  if (!base) {
    throw new FaceMlUnavailableError('FACE_ML_URL is not configured', null);
  }
  return base;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Parse the service's embedding string, refusing anything that is not 512 finite numbers. */
function parseEmbedding(raw: unknown): Float32Array {
  let values: unknown = raw;
  if (typeof raw === 'string') {
    try {
      values = JSON.parse(raw);
    } catch {
      throw new FaceMlResponseError('an embedding is not valid JSON');
    }
  }
  if (!Array.isArray(values) || values.length !== FACE_EMBEDDING_DIM) {
    throw new FaceMlResponseError(
      `an embedding has ${Array.isArray(values) ? values.length : 'no'} values, expected ${FACE_EMBEDDING_DIM}`
    );
  }
  const out = new Float32Array(FACE_EMBEDDING_DIM);
  let nonZero = false;
  for (let i = 0; i < out.length; i++) {
    if (!finite(values[i])) {
      throw new FaceMlResponseError('an embedding holds a non-finite value');
    }
    out[i] = values[i] as number;
    nonZero ||= out[i] !== 0;
  }
  if (!nonZero) {
    // A zero vector has no direction: every distance to it is NaN. Refused here, at the source.
    throw new FaceMlResponseError('an embedding is all zeros');
  }
  return out;
}

/** Validate the service's answer into {@link DetectedImage}. Exported for the tests. */
export function parsePrediction(body: unknown): DetectedImage {
  const b = body as Record<string, unknown> | null;
  if (!b || typeof b !== 'object') {
    throw new FaceMlResponseError('the answer is not an object');
  }
  const imageWidth = b.imageWidth;
  const imageHeight = b.imageHeight;
  if (!finite(imageWidth) || !finite(imageHeight) || imageWidth <= 0 || imageHeight <= 0) {
    throw new FaceMlResponseError('the answer carries no image size');
  }
  const list = b['facial-recognition'];
  if (!Array.isArray(list)) {
    throw new FaceMlResponseError('the answer carries no face list');
  }
  const faces = list.map((entry: unknown): DetectedFace => {
    const f = entry as Record<string, unknown> | null;
    const box = f?.boundingBox as Record<string, unknown> | undefined;
    if (
      !f ||
      !box ||
      !finite(box.x1) ||
      !finite(box.y1) ||
      !finite(box.x2) ||
      !finite(box.y2) ||
      !finite(f.score)
    ) {
      throw new FaceMlResponseError('a face has no box or score');
    }
    return {
      box: { x1: box.x1, y1: box.y1, x2: box.x2, y2: box.y2 },
      score: f.score,
      embedding: parseEmbedding(f.embedding),
    };
  });
  return { imageWidth, imageHeight, faces };
}

/**
 * Detect and embed every face of `image` scoring at least `minScore`. Throws
 * {@link FaceMlUnavailableError} on a transport failure or a status saying the service did not
 * serve the request, {@link FaceMlImageRefusedError} when it refused the image itself, and
 * {@link FaceMlResponseError} on an answer that cannot be trusted.
 */
export async function detectFaces(
  fetchFn: typeof fetch,
  image: Blob,
  minScore: number = FACE_DETECTION_MIN_SCORE
): Promise<DetectedImage> {
  const form = new FormData();
  form.append(
    'entries',
    JSON.stringify({
      'facial-recognition': {
        detection: { modelName: FACE_MODEL, options: { minScore } },
        recognition: { modelName: FACE_MODEL },
      },
    })
  );
  form.append('image', image);

  let res: Response;
  try {
    res = await fetchFn(`${mlBase()}/predict`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(FACE_ML_TIMEOUT_MS),
    });
  } catch (e) {
    if (e instanceof FaceMlUnavailableError) {
      throw e;
    }
    const message = e instanceof Error ? e.message : String(e);
    log.warn('face model unreachable', { error: message });
    throw new FaceMlUnavailableError(`face model unreachable: ${message}`, null);
  }
  if (!res.ok) {
    // The body is not read into the error: it may echo the request.
    await res.body?.cancel().catch(() => undefined);
    if (IMAGE_REFUSED_STATUSES.has(res.status)) {
      log.warn('face model refused the image', { status: res.status });
      throw new FaceMlImageRefusedError(res.status);
    }
    log.warn('face model did not answer', { status: res.status });
    throw new FaceMlUnavailableError(`face model answered ${res.status}`, res.status);
  }
  // Reading the body can fail like the request (a reset, the timeout): that is the service being
  // unavailable, not a bad answer. Only text that arrived and does not parse is the answer's fault.
  let text: string;
  try {
    text = await res.text();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    log.warn('face model answer could not be read', { error: message });
    throw new FaceMlUnavailableError(`face model answer unreadable: ${message}`, null);
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new FaceMlResponseError('the answer is not JSON');
  }
  const result = parsePrediction(body);
  log.debug('faces detected', {
    faces: result.faces.length,
    width: result.imageWidth,
    height: result.imageHeight,
  });
  return result;
}

/**
 * The one embedding of a selfie, or a {@link SelfieRefusedError} naming why. The image and the
 * other faces are dropped here.
 *
 * A REFERENCE MUST NEVER BE A BYSTANDER. The detector runs at the low floor
 * FACE_SELFIE_BYSTANDER_SCORE, so a half-visible face behind the member is SEEN: any second face
 * refuses the selfie. The one face must then be confident (FACE_DETECTION_MIN_SCORE).
 */
export async function selfieEmbedding(fetchFn: typeof fetch, image: Blob): Promise<Float32Array> {
  const result = await detectFaces(fetchFn, image, FACE_SELFIE_BYSTANDER_SCORE);
  const seen = result.faces.filter((f) => f.score >= FACE_SELFIE_BYSTANDER_SCORE);
  if (seen.length > 1) {
    log.info('selfie refused', { reason: 'several_faces', faces: seen.length });
    throw new SelfieRefusedError('several_faces', seen.length);
  }
  if (seen.length === 0 || seen[0].score < FACE_DETECTION_MIN_SCORE) {
    log.info('selfie refused', { reason: 'no_face', faces: seen.length });
    throw new SelfieRefusedError('no_face', seen.length);
  }
  return seen[0].embedding;
}
