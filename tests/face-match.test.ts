/**
 * Lot A2 of the face store (docs/wiki/face-matching-option-c.md): the model client, the matcher's
 * decision and the store scan. SYNTHETIC vectors only: seeded pseudo-random numbers, no photo and
 * no real person anywhere.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeTempDir } from './test-helpers';
import {
  FACE_AMBIGUITY_MARGIN,
  FACE_AUTO_MAX_DISTANCE,
  FACE_DETECTION_MIN_SCORE,
  FACE_EMBEDDING_DIM,
  FACE_MIN_REFERENCES,
  FACE_MODEL,
  FACE_SELFIE_BYSTANDER_SCORE,
  FACE_SUGGEST_MAX_DISTANCE,
  cosineDistance,
  decodeEmbedding,
  encodeEmbedding,
  halfToFloat,
  normalizeEmbedding,
} from '#lib/face-embedding.ts';
import { decideBand, decideFace, type MemberReferences } from '#lib/face-match.ts';
import { embeddingContext, parseSealKey, seal } from '#lib/server/face-seal.ts';

const env: Record<string, string | undefined> = { IMMICH_BASE_URL: '', IMMICH_API_KEY: '' };
vi.mock('#lib/server/env.ts', () => ({ env }));

function synthetic(seed: number): Float32Array {
  let a = seed >>> 0;
  const out = new Float32Array(FACE_EMBEDDING_DIM);
  for (let i = 0; i < out.length; i++) {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    out[i] = (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  }
  return out;
}

/** A vector at an exact cosine distance `d` from `base`. */
function atDistance(base: Float32Array, other: Float32Array, d: number): Float32Array {
  const u = normalizeEmbedding(base);
  const o = normalizeEmbedding(other);
  let dot = 0;
  for (let i = 0; i < u.length; i++) dot += u[i] * o[i];
  const w = new Float32Array(u.length);
  for (let i = 0; i < u.length; i++) w[i] = o[i] - dot * u[i];
  const v = normalizeEmbedding(w);
  const cos = 1 - d;
  const sin = Math.sqrt(1 - cos * cos);
  const out = new Float32Array(u.length);
  for (let i = 0; i < u.length; i++) out[i] = cos * u[i] + sin * v[i];
  return out;
}

/** A member whose `n` references all sit exactly `d` from `face`. */
function memberAt(
  userId: string,
  face: Float32Array,
  d: number,
  n = 3,
  seed = 100
): MemberReferences {
  return {
    userId,
    refs: Array.from({ length: n }, (_, i) => atDistance(face, synthetic(seed + i), d)),
  };
}

describe('the decoder table', () => {
  it('decodes every half exactly as halfToFloat does', () => {
    const bytes = new Uint8Array(FACE_EMBEDDING_DIM * 2);
    const view = new DataView(bytes.buffer);
    for (let start = 0; start < 0x10000; start += FACE_EMBEDDING_DIM) {
      for (let i = 0; i < FACE_EMBEDDING_DIM; i++)
        view.setUint16(i * 2, (start + i) & 0xffff, true);
      const out = decodeEmbedding(bytes);
      for (let i = 0; i < FACE_EMBEDDING_DIM; i++) {
        const want = Math.fround(halfToFloat((start + i) & 0xffff));
        if (Number.isNaN(want)) expect(Number.isNaN(out[i])).toBe(true);
        else expect(out[i]).toBe(want);
      }
    }
  });
});

describe('decideBand', () => {
  it('accepts a confident face of a fully enrolled member with no close runner-up', () => {
    expect(decideBand(FACE_AUTO_MAX_DISTANCE, null, FACE_MIN_REFERENCES)).toBe('auto');
    expect(decideBand(0.25, 0.25 + FACE_AMBIGUITY_MARGIN + 1e-9, FACE_MIN_REFERENCES)).toBe('auto');
  });

  it('puts a runner-up exactly at the margin outside it', () => {
    // 0.05 - 0 is exactly the margin in binary: strictly less than it is ambiguous, equal is not.
    expect(decideBand(0, FACE_AMBIGUITY_MARGIN, FACE_MIN_REFERENCES)).toBe('auto');
  });

  it('never auto-accepts on fewer references than the minimum', () => {
    expect(decideBand(0.1, null, FACE_MIN_REFERENCES - 1)).toBe('suggested');
    expect(decideBand(0.1, null, 1)).toBe('suggested');
  });

  it('never auto-accepts when the runner-up is within the margin', () => {
    expect(decideBand(0.3, 0.3 + FACE_AMBIGUITY_MARGIN - 1e-6, FACE_MIN_REFERENCES)).toBe(
      'suggested'
    );
    expect(decideBand(0.3, 0.3, FACE_MIN_REFERENCES)).toBe('suggested');
  });

  it('keeps the suggested band and nothing beyond it', () => {
    expect(decideBand(FACE_SUGGEST_MAX_DISTANCE, null, 5)).toBe('suggested');
    expect(decideBand(FACE_SUGGEST_MAX_DISTANCE + 1e-6, null, 5)).toBe('none');
    expect(decideBand(NaN, null, 5)).toBe('none');
  });
});

describe('decideFace', () => {
  const face = synthetic(1);

  it('gives the face to the nearest member only, with the runner-up distance', () => {
    const a = memberAt('a', face, 0.3, 3, 10);
    const b = memberAt('b', face, 0.45, 3, 20);
    const got = decideFace(face, [b, a]);
    expect(got?.userId).toBe('a');
    expect(got?.distance).toBeCloseTo(0.3, 5);
    expect(got?.runnerUp).toBeCloseTo(0.45, 5);
    expect(got?.band).toBe('auto');
  });

  it('downgrades a lookalike to suggested', () => {
    const a = memberAt('a', face, 0.3, 3, 10);
    const b = memberAt('b', face, 0.3 + FACE_AMBIGUITY_MARGIN / 2, 3, 20);
    expect(decideFace(face, [a, b])?.band).toBe('suggested');
    expect(decideFace(face, [a, b])?.userId).toBe('a');
  });

  it('uses the minimum over a member references', () => {
    const near = atDistance(face, synthetic(30), 0.2);
    const far = atDistance(face, synthetic(31), 0.9);
    const got = decideFace(face, [{ userId: 'a', refs: [far, near, far] }]);
    expect(got?.distance).toBeCloseTo(0.2, 5);
  });

  it('offers a face to the next member past one who rejected it, never as auto', () => {
    const a = memberAt('a', face, 0.2, 3, 10);
    const b = memberAt('b', face, 0.4, 3, 20);
    const got = decideFace(face, [a, b], new Set(['a']));
    expect(got?.userId).toBe('b');
    // The member who rejected it is still the runner-up: a lookalike case, past a human.
    expect(got?.runnerUp).toBeCloseTo(0.2, 5);
    expect(got?.band).toBe('suggested');
  });

  it('keeps auto past a rejection that is far from the face', () => {
    const a = memberAt('a', face, 0.6, 3, 10);
    const b = memberAt('b', face, 0.3, 3, 20);
    const got = decideFace(face, [a, b], new Set(['a']));
    expect(got?.userId).toBe('b');
    expect(got?.band).toBe('auto');
  });

  it('matches nobody beyond the suggested band, and nobody without members', () => {
    expect(decideFace(face, [memberAt('a', face, FACE_SUGGEST_MAX_DISTANCE + 0.05)])).toBeNull();
    expect(decideFace(face, [])).toBeNull();
    expect(decideFace(face, [{ userId: 'a', refs: [] }])).toBeNull();
  });

  it('skips a member with a corrupt reference and reports it', () => {
    const broken = synthetic(40);
    broken[0] = NaN;
    const reported: string[] = [];
    const got = decideFace(
      face,
      [{ userId: 'bad', refs: [broken] }, memberAt('ok', face, 0.4)],
      undefined,
      { invalidReference: (u) => reported.push(u) }
    );
    expect(got?.userId).toBe('ok');
    expect(reported).toEqual(['bad']);
  });

  it('reports a corrupt face once, as the face, and blames no member', () => {
    const broken = Float32Array.from(face);
    broken[3] = NaN;
    const members: string[] = [];
    let faces = 0;
    const got = decideFace(
      broken,
      [memberAt('a', face, 0.1), memberAt('b', face, 0.3)],
      undefined,
      {
        invalidReference: (u) => members.push(u),
        invalidCandidate: () => faces++,
      }
    );
    expect(got).toBeNull();
    expect(faces).toBe(1);
    expect(members).toEqual([]);
  });

  it('gives the same answer through the float16 store as from float32', () => {
    const a = memberAt('a', face, 0.35, 3, 10);
    const stored = decodeEmbedding(encodeEmbedding(face));
    const got = decideFace(stored, [a]);
    expect(got?.band).toBe('auto');
    expect(Math.abs((got?.distance ?? 0) - 0.35)).toBeLessThan(1e-3);
  });
});

describe('the model client', () => {
  let ml: typeof import('#lib/server/face-ml.ts');

  beforeAll(async () => {
    ml = await import('#lib/server/face-ml.ts');
  });

  beforeEach(() => {
    env.FACE_ML_URL = 'http://ml.test:3003/';
  });

  function face(score: number, seed: number, asString = true) {
    const v = Array.from(synthetic(seed));
    return {
      boundingBox: { x1: 10, y1: 20, x2: 110, y2: 140 },
      score,
      embedding: asString ? JSON.stringify(v) : v,
    };
  }

  function answer(faces: unknown[]) {
    return { imageWidth: 1440, imageHeight: 1080, 'facial-recognition': faces };
  }

  function fetchReturning(body: unknown, status = 200) {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fn = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(body), { status });
    }) as unknown as typeof fetch;
    return { fn, calls };
  }

  it('asks buffalo_l for detection and recognition at the score floor, multipart', async () => {
    const { fn, calls } = fetchReturning(answer([face(0.9, 1)]));
    const result = await ml.detectFaces(fn, new Blob([new Uint8Array([1, 2, 3])]));
    expect(calls[0].url).toBe('http://ml.test:3003/predict');
    const form = calls[0].init.body as FormData;
    expect(JSON.parse(String(form.get('entries')))).toEqual({
      'facial-recognition': {
        detection: { modelName: FACE_MODEL, options: { minScore: FACE_DETECTION_MIN_SCORE } },
        recognition: { modelName: FACE_MODEL },
      },
    });
    expect(form.get('image')).toBeInstanceOf(Blob);
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
    expect(result.imageWidth).toBe(1440);
    expect(result.faces).toHaveLength(1);
    expect(result.faces[0].box).toEqual({ x1: 10, y1: 20, x2: 110, y2: 140 });
    expect(cosineDistance(result.faces[0].embedding, synthetic(1))).toBeLessThan(1e-6);
  });

  it('accepts the embedding as an array as well as a string', () => {
    const got = ml.parsePrediction(answer([face(0.9, 2, false)]));
    expect(got.faces[0].embedding).toHaveLength(FACE_EMBEDDING_DIM);
  });

  it('refuses an answer it cannot trust', () => {
    const short = { ...face(0.9, 3), embedding: JSON.stringify([1, 2, 3]) };
    expect(() => ml.parsePrediction(answer([short]))).toThrow(ml.FaceMlResponseError);
    const long = { ...face(0.9, 3), embedding: JSON.stringify([...synthetic(3), 0.5]) };
    expect(() => ml.parsePrediction(answer([long]))).toThrow(ml.FaceMlResponseError);
    const notJson = { ...face(0.9, 3), embedding: '[1,2,' };
    expect(() => ml.parsePrediction(answer([notJson]))).toThrow(ml.FaceMlResponseError);
    const withNull = Array.from(synthetic(4)) as Array<number | null>;
    withNull[5] = null;
    expect(() =>
      ml.parsePrediction(answer([{ ...face(0.9, 4), embedding: JSON.stringify(withNull) }]))
    ).toThrow(ml.FaceMlResponseError);
    expect(() => ml.parsePrediction(answer([{ score: 0.9, embedding: '[]' }]))).toThrow(
      ml.FaceMlResponseError
    );
    expect(() => ml.parsePrediction({ 'facial-recognition': [] })).toThrow(ml.FaceMlResponseError);
    expect(() => ml.parsePrediction({ imageWidth: 1, imageHeight: 1 })).toThrow(
      ml.FaceMlResponseError
    );
    expect(() => ml.parsePrediction(null)).toThrow(ml.FaceMlResponseError);
    const zeros = {
      ...face(0.9, 3),
      embedding: JSON.stringify(new Array(FACE_EMBEDDING_DIM).fill(0)),
    };
    expect(() => ml.parsePrediction(answer([zeros]))).toThrow(/all zeros/);
  });

  it('types an answer that cannot be read as unavailable, and one that is not JSON as bad', async () => {
    const cut = (async () =>
      new Response(
        new ReadableStream({
          start(c) {
            c.error(new Error('socket hang up'));
          },
        })
      )) as unknown as typeof fetch;
    await expect(ml.detectFaces(cut, new Blob([]))).rejects.toBeInstanceOf(
      ml.FaceMlUnavailableError
    );
    const garbled = (async () => new Response('<html>')) as unknown as typeof fetch;
    await expect(ml.detectFaces(garbled, new Blob([]))).rejects.toBeInstanceOf(
      ml.FaceMlResponseError
    );
  });

  it('types a refusal and an unreachable service as unavailable, never as a result', async () => {
    const refused = fetchReturning({ detail: 'x' }, 500);
    await expect(ml.detectFaces(refused.fn, new Blob([]))).rejects.toBeInstanceOf(
      ml.FaceMlUnavailableError
    );
    const down = (async () => {
      throw new TypeError('connect ECONNREFUSED');
    }) as unknown as typeof fetch;
    await expect(ml.detectFaces(down, new Blob([]))).rejects.toBeInstanceOf(
      ml.FaceMlUnavailableError
    );
    env.FACE_ML_URL = undefined;
    await expect(ml.detectFaces(refused.fn, new Blob([]))).rejects.toBeInstanceOf(
      ml.FaceMlUnavailableError
    );
  });

  it('takes a selfie only with exactly one confident face and no bystander', async () => {
    const one = fetchReturning(
      answer([face(0.95, 5), face(FACE_SELFIE_BYSTANDER_SCORE - 0.01, 6)])
    );
    const v = await ml.selfieEmbedding(one.fn, new Blob([]));
    expect(cosineDistance(v, synthetic(5))).toBeLessThan(1e-6);
    // Searched at the low floor, so a faint face behind the member is seen.
    const form = one.calls[0].init.body as FormData;
    expect(
      JSON.parse(String(form.get('entries')))['facial-recognition'].detection.options.minScore
    ).toBe(FACE_SELFIE_BYSTANDER_SCORE);

    const bystander = fetchReturning(answer([face(0.95, 5), face(FACE_SELFIE_BYSTANDER_SCORE, 6)]));
    await expect(ml.selfieEmbedding(bystander.fn, new Blob([]))).rejects.toMatchObject({
      reason: 'several_faces',
      faces: 2,
    });

    const none = fetchReturning(answer([]));
    await expect(ml.selfieEmbedding(none.fn, new Blob([]))).rejects.toMatchObject({
      reason: 'no_face',
    });
    const weak = fetchReturning(answer([face(FACE_DETECTION_MIN_SCORE - 0.01, 7)]));
    await expect(ml.selfieEmbedding(weak.fn, new Blob([]))).rejects.toMatchObject({
      reason: 'no_face',
    });
    const two = fetchReturning(answer([face(0.9, 8), face(FACE_DETECTION_MIN_SCORE, 9)]));
    await expect(ml.selfieEmbedding(two.fn, new Blob([]))).rejects.toMatchObject({
      reason: 'several_faces',
      faces: 2,
    });
  });

  it('never writes an embedding value into a log line or an error', async () => {
    const lines: string[] = [];
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        lines.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
      })
    );
    const prev = process.env.LOG_LEVEL;
    process.env.LOG_LEVEL = 'debug';
    vi.resetModules();
    try {
      const fresh = await import('#lib/server/face-ml.ts');
      const errors: string[] = [];
      const ok = fetchReturning(answer([face(0.9, 11), face(0.8, 12)]));
      await fresh.detectFaces(ok.fn, new Blob([]));
      await fresh.selfieEmbedding(ok.fn, new Blob([])).catch((e: Error) => errors.push(e.message));
      const bad = fetchReturning(answer([{ ...face(0.9, 13), embedding: '[1,2,3]' }]));
      await fresh.detectFaces(bad.fn, new Blob([])).catch((e: Error) => errors.push(e.message));
      expect(lines.length).toBeGreaterThan(0);
      const values = [...synthetic(11).slice(0, 8), ...synthetic(12).slice(0, 8)].map((x) =>
        String(x).slice(0, 8)
      );
      for (const text of [...lines, ...errors]) {
        for (const value of values) expect(text).not.toContain(value);
      }
    } finally {
      process.env.LOG_LEVEL = prev;
      for (const spy of spies) spy.mockRestore();
      vi.resetModules();
    }
  });
});

describe('the store scan', () => {
  let database: typeof import('#lib/db/database.ts');
  let store: typeof import('#lib/server/face-store.ts');
  let refs: typeof import('#lib/server/face-references.ts');
  let dbDir: string;
  const key = parseSealKey('cd'.repeat(32));
  const otherKey = parseSealKey('ef'.repeat(32));

  function db() {
    return database.getDatabase();
  }

  function storeFace(assetId: string, index: number, vector: Float32Array, k = key) {
    db()
      .prepare(
        `INSERT INTO face_embeddings (asset_id, face_index, model, x1, y1, x2, y2, img_w, img_h,
           score, sealed, created_at) VALUES (?, ?, ?, 0, 0, 1, 1, 10, 10, 0.9, ?, 0)`
      )
      .run(
        assetId,
        index,
        FACE_MODEL,
        seal(k, embeddingContext(assetId, index, FACE_MODEL), encodeEmbedding(vector))
      );
  }

  beforeAll(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'migallery-face-match-'));
    process.env.DATABASE_PATH = join(dbDir, 'face-match.db');
    database = await import('#lib/db/database.ts');
    store = await import('#lib/server/face-store.ts');
    refs = await import('#lib/server/face-references.ts');
  });

  afterAll(() => {
    database.resetDatabase();
    removeTempDir(dbDir);
  });

  beforeEach(() => {
    db().exec('DELETE FROM face_embeddings; DELETE FROM face_references; DELETE FROM users;');
  });

  it('reads the key from the environment and refuses a malformed one', () => {
    env.FACE_STORE_KEY = 'cd'.repeat(32);
    expect(store.faceStoreKey().equals(key)).toBe(true);
    env.FACE_STORE_KEY = 'short';
    expect(() => store.faceStoreKey()).toThrow(/64 hex/);
    env.FACE_STORE_KEY = undefined;
    expect(() => store.faceStoreKey()).toThrow(/64 hex/);
    expect(store.faceStoreConfigured()).toBe(false);
  });

  it('visits every face it can open and counts the ones it cannot', async () => {
    storeFace('a1', 0, synthetic(1));
    storeFace('a1', 1, synthetic(2));
    storeFace('a2', 0, synthetic(3), otherKey);
    const seen: string[] = [];
    const result = await store.scanFaceStore(db(), key, (f, v) => {
      seen.push(`${f.assetId}/${f.faceIndex}`);
      expect(v).toHaveLength(FACE_EMBEDDING_DIM);
    });
    expect(result).toEqual({ visited: 2, failed: 1 });
    expect(seen.sort()).toEqual(['a1/0', 'a1/1']);
  });

  it('reads past a chunk boundary and yields between chunks', async () => {
    const n = store.SCAN_CHUNK * 2 + 3;
    const sealedOne = (asset: string) =>
      seal(key, embeddingContext(asset, 0, FACE_MODEL), encodeEmbedding(synthetic(9)));
    db().exec('BEGIN');
    for (let i = 0; i < n; i++) {
      db()
        .prepare(
          `INSERT INTO face_embeddings (asset_id, face_index, model, x1, y1, x2, y2, img_w, img_h,
             score, sealed, created_at) VALUES (?, 0, ?, 0, 0, 1, 1, 10, 10, 0.9, ?, 0)`
        )
        .run(`c${i}`, FACE_MODEL, sealedOne(`c${i}`));
    }
    db().exec('COMMIT');
    const seen = new Set<string>();
    let yielded = false;
    setImmediate(() => (yielded = true));
    const result = await store.scanFaceStore(db(), key, (f) => seen.add(f.assetId));
    expect(result).toEqual({ visited: n, failed: 0 });
    expect(seen.size).toBe(n);
    expect(yielded).toBe(true);
  });

  it('opens chosen faces only, leaving out the missing and the unopenable', () => {
    storeFace('a1', 0, synthetic(1));
    storeFace('a2', 0, synthetic(2), otherKey);
    const got = store.loadFaceEmbeddings(db(), key, [
      { assetId: 'a1', faceIndex: 0 },
      { assetId: 'a2', faceIndex: 0 },
      { assetId: 'nope', faceIndex: 0 },
    ]);
    expect(got.map((f) => f.assetId)).toEqual(['a1']);
    expect(cosineDistance(got[0].embedding, synthetic(1))).toBeLessThan(1e-5);
  });

  it('loads every member references and drops a member whose blob does not open', () => {
    for (const id of ['m1', 'm2']) {
      db().prepare('INSERT INTO users (id_user, name) VALUES (?, ?)').run(id, id);
    }
    refs.addFaceReference(db(), key, 'm1', 'selfie', synthetic(1));
    refs.addFaceReference(db(), key, 'm1', 'photo', synthetic(2));
    refs.addFaceReference(db(), key, 'm2', 'selfie', synthetic(3));
    refs.addFaceReference(db(), otherKey, 'm2', 'photo', synthetic(4));
    const members = store.loadAllReferences(db(), key);
    expect(members.map((m) => m.userId)).toEqual(['m1']);
    expect(members[0].refs).toHaveLength(2);
  });
});
