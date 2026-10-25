/**
 * Lot A1 of the face store (docs/wiki/face-store.md): the float16 codec, the distance and its
 * bands, the sealing, and the two tables. SYNTHETIC vectors only: seeded pseudo-random numbers, no
 * photo and no real person anywhere.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeTempDir } from './test-helpers';
import {
  FACE_AUTO_MAX_DISTANCE,
  FACE_EMBEDDING_DIM,
  FACE_MAX_REFERENCES,
  FACE_SUGGEST_MAX_DISTANCE,
  classifyDistance,
  cosineDistance,
  decodeEmbedding,
  encodeEmbedding,
  floatToHalf,
  halfToFloat,
  minDistance,
  normalizeEmbedding,
} from '$lib/face-embedding';
import { SEAL_OVERHEAD, parseSealKey, seal, unseal } from '$lib/server/face-seal';

vi.mock('$env/dynamic/private', () => ({ env: { IMMICH_BASE_URL: '', IMMICH_API_KEY: '' } }));

/** Deterministic pseudo-random vector (mulberry32), so a failure reproduces. */
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

/** A vector at an exact cosine distance `d` from `base` (rotating towards an orthogonal one). */
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

describe('the float16 codec', () => {
  it('matches the IEEE-754 half values it must know', () => {
    expect(floatToHalf(0)).toBe(0x0000);
    expect(floatToHalf(1)).toBe(0x3c00);
    expect(floatToHalf(-2)).toBe(0xc000);
    expect(floatToHalf(65504)).toBe(0x7bff);
    expect(floatToHalf(1e6)).toBe(0x7c00);
    expect(floatToHalf(2 ** -24)).toBe(0x0001);
    expect(halfToFloat(0x3c00)).toBe(1);
    expect(halfToFloat(0xc000)).toBe(-2);
    expect(halfToFloat(0x0001)).toBe(2 ** -24);
    expect(Number.isNaN(halfToFloat(floatToHalf(NaN)))).toBe(true);
  });

  it('round-trips every half exactly', () => {
    for (let h = 0; h < 0x10000; h++) {
      const f = halfToFloat(h);
      if (Number.isNaN(f)) continue;
      expect(floatToHalf(f)).toBe(h);
    }
  });

  it('encodes 1024 bytes and decodes within half precision', () => {
    const v = normalizeEmbedding(synthetic(1));
    const bytes = encodeEmbedding(v);
    expect(bytes.length).toBe(FACE_EMBEDDING_DIM * 2);
    const back = decodeEmbedding(bytes);
    for (let i = 0; i < v.length; i++) {
      expect(Math.abs(back[i] - v[i])).toBeLessThan(1e-3);
    }
    expect(cosineDistance(v, back)).toBeLessThan(1e-5);
  });

  it('refuses a vector that cannot be compared', () => {
    expect(() => normalizeEmbedding(new Float32Array(10).fill(1))).toThrow(/dimensions/);
    expect(() => normalizeEmbedding(new Float32Array(FACE_EMBEDDING_DIM))).toThrow(/zero/);
    const bad = synthetic(2);
    bad[3] = NaN;
    expect(() => normalizeEmbedding(bad)).toThrow(/non-finite/);
    expect(() => decodeEmbedding(new Uint8Array(10))).toThrow(/bytes/);
  });
});

describe('distance and bands', () => {
  const base = synthetic(10);
  const other = synthetic(11);

  it('is 0 for the same vector, near 1 for unrelated ones, and exact where built', () => {
    expect(cosineDistance(base, base)).toBeCloseTo(0, 6);
    expect(Math.abs(cosineDistance(base, other) - 1)).toBeLessThan(0.15);
    expect(cosineDistance(base, atDistance(base, other, 0.4))).toBeCloseTo(0.4, 5);
  });

  it('takes the minimum over the references', () => {
    const refs = [atDistance(base, other, 0.9), atDistance(base, other, 0.3), synthetic(12)];
    expect(minDistance(refs, base)).toBeCloseTo(0.3, 5);
    expect(() => minDistance([], base)).toThrow(/no reference/);
  });

  it('classifies at the bounds, both inclusive', () => {
    expect(classifyDistance(0)).toBe('auto');
    expect(classifyDistance(FACE_AUTO_MAX_DISTANCE)).toBe('auto');
    expect(classifyDistance(FACE_AUTO_MAX_DISTANCE + 1e-9)).toBe('suggested');
    expect(classifyDistance(FACE_SUGGEST_MAX_DISTANCE)).toBe('suggested');
    expect(classifyDistance(FACE_SUGGEST_MAX_DISTANCE + 1e-9)).toBe('none');
    expect(classifyDistance(NaN)).toBe('none');
    expect(classifyDistance(-0.1)).toBe('none');
  });

  it('keeps the decided numbers', () => {
    expect(FACE_AUTO_MAX_DISTANCE).toBe(0.5);
    expect(FACE_SUGGEST_MAX_DISTANCE).toBe(0.62);
    expect(FACE_MAX_REFERENCES).toBe(5);
  });
});

describe('sealing', () => {
  const key = parseSealKey('ab'.repeat(32));
  const plain = encodeEmbedding(synthetic(20));

  it('opens what it sealed and adds exactly the overhead', () => {
    const sealed = seal(key, 'ctx:1', plain);
    expect(sealed.length).toBe(plain.length + SEAL_OVERHEAD);
    expect(Buffer.from(unseal(key, 'ctx:1', sealed)).equals(Buffer.from(plain))).toBe(true);
  });

  it('never repeats a ciphertext for the same plaintext', () => {
    const a = Buffer.from(seal(key, 'ctx:1', plain));
    const b = Buffer.from(seal(key, 'ctx:1', plain));
    expect(a.equals(b)).toBe(false);
  });

  it('refuses another context, another key and a flipped byte', () => {
    const sealed = seal(key, 'ctx:1', plain);
    expect(() => unseal(key, 'ctx:2', sealed)).toThrow();
    expect(() => unseal(parseSealKey('cd'.repeat(32)), 'ctx:1', sealed)).toThrow();
    const flipped = Uint8Array.from(sealed);
    flipped[20] ^= 1;
    expect(() => unseal(key, 'ctx:1', flipped)).toThrow();
    expect(() => unseal(key, 'ctx:1', new Uint8Array(5))).toThrow(/short/);
  });

  it('accepts only a 64-hex key', () => {
    expect(() => parseSealKey(undefined)).toThrow(/64 hex/);
    expect(() => parseSealKey('abc')).toThrow(/64 hex/);
    expect(() => parseSealKey('zz'.repeat(32))).toThrow(/64 hex/);
  });
});

describe('the tables', () => {
  let database: typeof import('$lib/db/database');
  let refs: typeof import('$lib/server/face-references');
  let dbDir: string;
  const key = parseSealKey('ab'.repeat(32));

  function addUser(id: string) {
    database.getDatabase().prepare('INSERT INTO users (id_user, name) VALUES (?, ?)').run(id, id);
  }

  function count(table: string): number {
    return (
      database.getDatabase().prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }
    ).n;
  }

  beforeAll(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'migallery-face-store-'));
    process.env.DATABASE_PATH = join(dbDir, 'face-store.db');
    database = await import('$lib/db/database');
    refs = await import('$lib/server/face-references');
  });

  afterAll(() => {
    database.resetDatabase();
    removeTempDir(dbDir);
  });

  beforeEach(() => {
    database.getDatabase().exec('DELETE FROM face_references; DELETE FROM users;');
  });

  it('turns secure_delete on', () => {
    const row = database.getDatabase().prepare('PRAGMA secure_delete').get() as Record<
      string,
      number
    >;
    expect(Object.values(row)[0]).toBeGreaterThan(0);
  });

  it('stores a reference sealed, and reads it back', () => {
    addUser('m1');
    const v = normalizeEmbedding(synthetic(30));
    expect(refs.addFaceReference(database.getDatabase(), key, 'm1', 'selfie', v)).toBe(true);
    const raw = database
      .getDatabase()
      .prepare('SELECT sealed FROM face_references WHERE user_id = ?')
      .get('m1') as { sealed: Uint8Array };
    // No float16 payload in the clear: the stored bytes are not the encoded vector.
    expect(Buffer.from(raw.sealed).includes(Buffer.from(encodeEmbedding(v)))).toBe(false);
    const [back] = refs.loadFaceReferences(database.getDatabase(), key, 'm1');
    expect(cosineDistance(v, back)).toBeLessThan(1e-5);
  });

  it('holds the cap of five, in the helper and in the table', () => {
    addUser('m2');
    const db = database.getDatabase();
    for (let i = 0; i < FACE_MAX_REFERENCES; i++) {
      expect(refs.addFaceReference(db, key, 'm2', 'photo', synthetic(40 + i))).toBe(true);
    }
    expect(refs.addFaceReference(db, key, 'm2', 'photo', synthetic(99))).toBe(false);
    expect(() =>
      db
        .prepare(
          "INSERT INTO face_references (user_id, model, source, sealed, created_at) VALUES ('m2', 'buffalo_l', 'admin', x'00', 0)"
        )
        .run()
    ).toThrow(/at most 5/);
    expect(count('face_references')).toBe(5);
  });

  it('refuses a reference copied onto another member', () => {
    addUser('a');
    addUser('b');
    const db = database.getDatabase();
    refs.addFaceReference(db, key, 'a', 'selfie', synthetic(50));
    db.prepare("UPDATE face_references SET user_id = 'b' WHERE user_id = 'a'").run();
    expect(() => refs.loadFaceReferences(db, key, 'b')).toThrow();
  });

  it('erases on withdrawal and by cascade on account deletion', () => {
    addUser('c');
    addUser('d');
    const db = database.getDatabase();
    refs.addFaceReference(db, key, 'c', 'selfie', synthetic(60));
    refs.addFaceReference(db, key, 'd', 'selfie', synthetic(61));
    expect(refs.eraseFaceReferences(db, 'c')).toBe(1);
    db.prepare("DELETE FROM users WHERE id_user = 'd'").run();
    expect(count('face_references')).toBe(0);
  });

  it('has the embedding table, keyed by asset and face', () => {
    const db = database.getDatabase();
    const insert = db.prepare(
      "INSERT INTO face_embeddings (asset_id, face_index, model, x1, y1, x2, y2, img_w, img_h, score, sealed, created_at) VALUES ('s', ?, 'buffalo_l', 0, 0, 1, 1, 10, 10, 0.9, x'00', 0)"
    );
    insert.run(0);
    insert.run(1);
    expect(() => insert.run(1)).toThrow();
    db.exec('DELETE FROM face_embeddings');
  });
});
