/**
 * Lot A1 of the face store (docs/wiki/face-store.md): the float16 codec, the distance and its
 * bands, the sealing, and the two tables. SYNTHETIC vectors only: seeded pseudo-random numbers, no
 * photo and no real person anywhere.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { createCipheriv, randomBytes } from 'node:crypto';
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
import {
  SEAL_OVERHEAD,
  SEAL_VERSION,
  embeddingContext,
  parseSealKey,
  referenceContext,
  seal,
  unseal,
} from '$lib/server/face-seal';

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

  // The reference is the runtime's own binary16 rounding (bun 1.4.0: Math.f16round, setFloat16).
  const refView = new DataView(new ArrayBuffer(2));
  function refBits(x: number): number {
    (refView as unknown as { setFloat16(o: number, v: number): void }).setFloat16(0, x);
    return refView.getUint16(0);
  }
  const f16round = (Math as unknown as { f16round(x: number): number }).f16round;

  it('has the runtime reference it is compared against', () => {
    expect(typeof f16round).toBe('function');
    expect(refBits(1)).toBe(0x3c00);
  });

  it('rounds random float32 values exactly like Math.f16round, in every exponent range', () => {
    const f32 = new Float32Array(1);
    const u32 = new Uint32Array(f32.buffer);
    let a = 12345;
    const next = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return (t ^ (t >>> 14)) >>> 0;
    };
    let compared = 0;
    for (let i = 0; i < 200_000; i++) {
      u32[0] = next(); // every bit pattern: all exponents, both signs
      if (i % 2) {
        // Half of the draws are squeezed into the half range (normals and subnormals).
        u32[0] = (u32[0] & 0x807fffff) | ((100 + (next() % 30)) << 23);
      }
      const x = f32[0];
      if (Number.isNaN(x)) continue;
      expect(floatToHalf(x), `bits ${u32[0].toString(16)}`).toBe(refBits(x));
      expect(halfToFloat(floatToHalf(x))).toBe(f16round(x));
      compared++;
    }
    expect(compared).toBeGreaterThan(190_000);
  });

  it('rounds ties to even and just beside them correctly, subnormals included', () => {
    for (let h = 0; h < 0x7bff; h++) {
      const lo = halfToFloat(h);
      const hi = halfToFloat(h + 1);
      const tie = Math.fround((lo + hi) / 2);
      for (const sign of [1, -1]) {
        const t = sign * tie;
        // Exactly half way: the even mantissa wins, as the runtime does.
        expect(floatToHalf(t), `tie after half ${h}`).toBe(refBits(t));
        const above = Math.fround(sign * (tie + (hi - lo) / 64));
        const below = Math.fround(sign * (tie - (hi - lo) / 64));
        expect(floatToHalf(above)).toBe(refBits(above));
        expect(floatToHalf(below)).toBe(refBits(below));
      }
    }
    // Spot-check the named cases: 2^-25 is the tie between 0 and the smallest subnormal (even: 0).
    expect(floatToHalf(2 ** -25)).toBe(0x0000);
    expect(floatToHalf(3 * 2 ** -25)).toBe(0x0002);
    expect(floatToHalf(65520)).toBe(0x7c00);
  });

  it('writes little-endian, pinned by a fixed byte vector', () => {
    const bytes = new Uint8Array(FACE_EMBEDDING_DIM * 2);
    bytes.set([0x00, 0x3c, 0x00, 0xc0]); // 1.0 then -2.0, little-endian halves
    const decoded = decodeEmbedding(bytes);
    expect(decoded[0]).toBe(1);
    expect(decoded[1]).toBe(-2);
    expect(decoded[2]).toBe(0);
    // And the encoder: a unit axis vector, and 3-4-5 normalised to 0.6 / -0.8.
    const axis = new Float32Array(FACE_EMBEDDING_DIM);
    axis[0] = 1;
    const axisBytes = encodeEmbedding(axis);
    expect([axisBytes[0], axisBytes[1], axisBytes[2], axisBytes[3]]).toEqual([0x00, 0x3c, 0, 0]);
    const tri = new Float32Array(FACE_EMBEDDING_DIM);
    tri[0] = 3;
    tri[1] = -4;
    const triBytes = encodeEmbedding(tri);
    expect([triBytes[0], triBytes[1], triBytes[2], triBytes[3]]).toEqual([0xcd, 0x38, 0x66, 0xba]);
  });

  it('encodeEmbedding normalises before packing', () => {
    const v = synthetic(7);
    const scaled = Float32Array.from(v, (x) => x * 37);
    for (const input of [v, scaled]) {
      const back = decodeEmbedding(encodeEmbedding(input));
      let norm = 0;
      for (const x of back) norm += x * x;
      expect(Math.sqrt(norm)).toBeCloseTo(1, 2);
    }
    expect(cosineDistance(decodeEmbedding(encodeEmbedding(scaled)), v)).toBeLessThan(1e-5);
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
    // A negative is not a NaN: cosineDistance never returns one (clamped), so only NaN is refused.
    expect(classifyDistance(-0.1)).toBe('auto');
    expect(classifyDistance(Infinity)).toBe('none');
  });

  it('never returns a negative distance, and parallel vectors are auto', () => {
    let negatives = 0;
    for (let seed = 1; seed <= 2000; seed++) {
      const v = synthetic(seed);
      const scaled = Float32Array.from(v, (x) => x * 3.7);
      const unit = normalizeEmbedding(v);
      for (const other of [v, scaled, unit]) {
        const d = cosineDistance(v, other);
        if (d < 0) negatives++;
        expect(classifyDistance(d)).toBe('auto');
      }
    }
    expect(negatives).toBe(0);
    expect(
      cosineDistance(
        base,
        Float32Array.from(base, (x) => -x)
      )
    ).toBeLessThanOrEqual(2);
    expect(
      cosineDistance(
        base,
        Float32Array.from(base, (x) => -x)
      )
    ).toBeGreaterThan(1.99);
  });

  it('does not call unrelated vectors scaled to underflow a match', () => {
    const a = Float64Array.from(synthetic(21), (x) => x * 1e-100);
    const b = Float64Array.from(synthetic(22), (x) => x * 1e-100);
    // na * nb underflows to 0 here; the distance must still be the true one, never a clamped match.
    expect(cosineDistance(a, b)).toBeCloseTo(cosineDistance(synthetic(21), synthetic(22)), 6);
    expect(classifyDistance(cosineDistance(a, b))).toBe('none');
  });

  it('answers NaN, and says which reference, when a reference is not finite', () => {
    const bad = Float32Array.from(base);
    bad[5] = NaN;
    const seen: number[] = [];
    const d = minDistance([base, bad], base, (i) => seen.push(i));
    expect(Number.isNaN(d)).toBe(true);
    expect(classifyDistance(d)).toBe('none');
    expect(seen).toEqual([1]);
  });

  it('accepts a single reference (the minimum of three is enforced at enrolment, not here)', () => {
    expect(minDistance([base], base)).toBeCloseTo(0, 6);
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

  it('starts with a format version, authenticates it, and refuses an unknown one', () => {
    const sealed = seal(key, 'ctx:1', plain);
    expect(sealed[0]).toBe(SEAL_VERSION);
    expect(SEAL_OVERHEAD).toBe(29);
    for (const other of [0, 2, 255]) {
      const forged = Uint8Array.from(sealed);
      forged[0] = other;
      expect(() => unseal(key, 'ctx:1', forged)).toThrow(/unknown seal version/);
    }
  });

  it('authenticates the version byte: a blob sealed with a context-only AAD is refused', () => {
    const ctx = 'ctx:1';
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 });
    cipher.setAAD(Buffer.from(ctx, 'utf8')); // no version in the AAD
    const body = Buffer.concat([cipher.update(plain), cipher.final()]);
    const forged = Buffer.concat([Buffer.from([SEAL_VERSION]), nonce, body, cipher.getAuthTag()]);
    expect(() => unseal(key, ctx, forged)).toThrow(/auth/i);
  });

  it('refuses a context part that JSON would equate with another', () => {
    for (const bad of [null, undefined, '', 5, {}, { toJSON: () => 'x' }]) {
      expect(() => referenceContext(bad as never, 'm')).toThrow();
      expect(() => referenceContext('a', bad as never)).toThrow();
      expect(() => embeddingContext(bad as never, 0, 'm')).toThrow();
      expect(() => embeddingContext('a', 0, bad as never)).toThrow();
    }
    for (const bad of [NaN, Infinity, -Infinity, -0, -1, 1.5, 2 ** 53, null, undefined, '1']) {
      expect(() => embeddingContext('a', bad as never, 'm')).toThrow();
    }
    expect(embeddingContext('a', 0, 'm')).toBe('["face_embeddings","a",0,"m"]');
  });

  it('has contexts that never collide, whatever characters an id holds', () => {
    // With ':' joining, ("a:b", "m") and ("a", "b:m") were the same string.
    expect(referenceContext('a:b', 'm')).not.toBe(referenceContext('a', 'b:m'));
    expect(referenceContext('a', 'b')).not.toBe(referenceContext('a', 'b '));
    expect(embeddingContext('x:1', 2, 'm')).not.toBe(embeddingContext('x', 1, '2:m'));
    expect(embeddingContext('x', 1, 'm')).not.toBe(referenceContext('x', 'm'));
    const sealed = seal(key, referenceContext('a:b', 'm'), plain);
    expect(() => unseal(key, referenceContext('a', 'b:m'), sealed)).toThrow();
    expect(() => unseal(key, referenceContext('a:b', 'm'), sealed)).not.toThrow();
  });

  it('binds an embedding to its asset, face index and model', () => {
    const sealed = seal(key, embeddingContext('asset', 0, 'buffalo_l'), plain);
    expect(() => unseal(key, embeddingContext('asset', 0, 'buffalo_l'), sealed)).not.toThrow();
    expect(() => unseal(key, embeddingContext('asset', 1, 'buffalo_l'), sealed)).toThrow();
    expect(() => unseal(key, embeddingContext('other', 0, 'buffalo_l'), sealed)).toThrow();
    expect(() => unseal(key, embeddingContext('asset', 0, 'other'), sealed)).toThrow();
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
  let link: typeof import('$lib/server/face-link');
  let erasure: typeof import('$lib/server/face-erasure');
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
    erasure = await import('$lib/server/face-erasure');
    link = await import('$lib/server/face-link');
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

  it('counts the cap per model, and the trigger number is the constant', () => {
    addUser('m3');
    const db = database.getDatabase();
    const insert = db.prepare(
      "INSERT INTO face_references (user_id, model, source, sealed, created_at) VALUES ('m3', ?, 'admin', x'00', 0)"
    );
    for (let i = 0; i < FACE_MAX_REFERENCES; i++) insert.run('old_model');
    // A full set of another model must not block the current model's references.
    expect(refs.addFaceReference(db, key, 'm3', 'photo', synthetic(70))).toBe(true);
    expect(() => insert.run('old_model')).toThrow(/at most 5/);
    const trigger = db
      .prepare("SELECT sql FROM sqlite_master WHERE name = 'trg_face_references_cap'")
      .get() as { sql: string };
    expect(trigger.sql).toContain(`>= ${FACE_MAX_REFERENCES}`);
    expect(trigger.sql).toContain('NEW.model');
  });

  it('erases references when consent is withdrawn, unlinked or relinked', () => {
    const db = database.getDatabase();
    for (const reason of ['withdrawal', 'admin_unlink', 'relink', 'account_deletion'] as const) {
      addUser(`w-${reason}`);
      addUser(`keep-${reason}`);
      refs.addFaceReference(db, key, `w-${reason}`, 'selfie', synthetic(80));
      refs.addFaceReference(db, key, `keep-${reason}`, 'selfie', synthetic(81));
      erasure.eraseLocalFaceData(db, `w-${reason}`, reason);
      expect(refs.loadFaceReferences(db, key, `w-${reason}`)).toHaveLength(0);
      expect(refs.loadFaceReferences(db, key, `keep-${reason}`)).toHaveLength(1);
    }
  });

  it('erases references on a withdrawal even when the member is already unlinked', () => {
    const db = database.getDatabase();
    addUser('u1');
    refs.addFaceReference(db, key, 'u1', 'selfie', synthetic(90));
    const result = link.applyFaceLink(db, 'u1', null, {
      source: 'selfie',
      unlinkReason: 'withdrawal',
    });
    expect(result.changed).toBe(false);
    expect(refs.loadFaceReferences(db, key, 'u1')).toHaveLength(0);
  });

  it('has the embedding table, keyed by asset, face and model', () => {
    const db = database.getDatabase();
    const insert = db.prepare(
      "INSERT INTO face_embeddings (asset_id, face_index, model, x1, y1, x2, y2, img_w, img_h, score, sealed, created_at) VALUES ('s', ?, ?, 0, 0, 1, 1, 10, 10, 0.9, x'00', 0)"
    );
    insert.run(0, 'buffalo_l');
    insert.run(1, 'buffalo_l');
    expect(() => insert.run(1, 'buffalo_l')).toThrow();
    insert.run(1, 'next_model'); // a re-embedding sits beside the old row
    db.exec('DELETE FROM face_embeddings');
  });
});
