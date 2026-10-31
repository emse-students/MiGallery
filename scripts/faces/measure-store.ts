/**
 * Cost of the sealed face store, measured on SYNTHETIC vectors (docs/wiki/face-matching-option-c.md,
 * "Measurements"): its size on disk, a full scan streamed from SQLite (open, decode, compare), and
 * the alternative of holding the whole store decoded in memory. Uses the production codec and
 * sealing, so the figures are the matcher's own. No real data is read.
 *
 * Usage: N=600000 REFS=5 bun scripts/faces/measure-store.ts [dbPath]
 */

import { Database } from 'bun:sqlite';
import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';
import {
  FACE_EMBEDDING_DIM,
  FACE_MODEL,
  decodeEmbedding,
  encodeEmbedding,
} from '../../src/lib/face-embedding.ts';
import { embeddingContext, seal, unseal } from '../../src/lib/server/face-seal.ts';

const N = Number(process.env.N ?? 600_000);
const REFS = Number(process.env.REFS ?? 5);
const DIM = FACE_EMBEDDING_DIM;
const path = process.argv[2] ?? '/tmp/face-store-measure.db';
const mb = () => Math.round(process.memoryUsage().rss / 1e6);
const secs = (t: number) => Number(((performance.now() - t) / 1000).toFixed(2));

let s = 1;
const rand = () => {
  s = (s + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296 - 0.5;
};
const vector = () => Float32Array.from({ length: DIM }, rand);

rmSync(path, { force: true });
const db = new Database(path);
db.exec('PRAGMA journal_mode = WAL; PRAGMA secure_delete = ON;');
db.exec(`CREATE TABLE face_embeddings (asset_id TEXT NOT NULL, face_index INTEGER NOT NULL,
  model TEXT NOT NULL, x1 REAL, y1 REAL, x2 REAL, y2 REAL, img_w INTEGER, img_h INTEGER, score REAL,
  sealed BLOB NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(asset_id, face_index, model))`);
const key = randomBytes(32);

const report: Record<string, unknown> = { n: N, refs: REFS, rssStartMB: mb() };
let t = performance.now();
const insert = db.prepare(
  'INSERT INTO face_embeddings VALUES (?, ?, ?, 0.1, 0.1, 0.2, 0.2, 1440, 1080, 0.8, ?, 0)'
);
const ids: string[] = [];
db.exec('BEGIN');
for (let i = 0; i < N; i++) {
  const asset = crypto.randomUUID();
  if (i < 1000) {
    ids.push(asset);
  }
  insert.run(
    asset,
    0,
    FACE_MODEL,
    seal(key, embeddingContext(asset, 0, FACE_MODEL), encodeEmbedding(vector()))
  );
  if (i % 50_000 === 49_999) {
    db.exec('COMMIT; BEGIN');
  }
}
db.exec('COMMIT');
db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
report.writeSeconds = secs(t);
report.fileMB = Math.round(Bun.file(path).size / 1e6);

const refs = Array.from({ length: REFS }, () => {
  const v = vector();
  const n = Math.hypot(...v);
  return v.map((x) => x / n);
});

// 1. Streamed scan: nothing kept but the distances below the band.
t = performance.now();
let peak = mb();
let kept = 0;
const rows = db.prepare('SELECT asset_id, face_index, sealed FROM face_embeddings WHERE model = ?');
let k = 0;
for (const row of rows.iterate(FACE_MODEL) as IterableIterator<{
  asset_id: string;
  face_index: number;
  sealed: Uint8Array;
}>) {
  const v = decodeEmbedding(
    unseal(key, embeddingContext(row.asset_id, row.face_index, FACE_MODEL), row.sealed)
  );
  let best = 2;
  for (const r of refs) {
    let dot = 0;
    for (let i = 0; i < DIM; i++) {
      dot += r[i] * v[i];
    }
    best = Math.min(best, 1 - dot);
  }
  if (best <= 0.62) {
    kept++;
  }
  if (++k % 100_000 === 0) {
    peak = Math.max(peak, mb());
  }
}
report.streamedScan = { seconds: secs(t), peakRssMB: Math.max(peak, mb()), kept };

// 2. Unseal cost alone, and the distance cost alone, on 50k rows.
t = performance.now();
const sample = db
  .prepare('SELECT asset_id, face_index, sealed FROM face_embeddings LIMIT 50000')
  .all() as Array<{ asset_id: string; face_index: number; sealed: Uint8Array }>;
report.read50kSeconds = secs(t);
t = performance.now();
const opened = sample.map((row) =>
  unseal(key, embeddingContext(row.asset_id, row.face_index, FACE_MODEL), row.sealed)
);
report.unseal50kSeconds = secs(t);
t = performance.now();
for (const o of opened) {
  decodeEmbedding(o);
}
report.decode50kSeconds = secs(t);

// 3. The alternative: the whole store decoded and held in memory as float16 halves.
const before = mb();
t = performance.now();
const halves = new Uint16Array(N * DIM);
let j = 0;
for (const row of rows.iterate(FACE_MODEL) as IterableIterator<{
  asset_id: string;
  face_index: number;
  sealed: Uint8Array;
}>) {
  const plain = unseal(key, embeddingContext(row.asset_id, row.face_index, FACE_MODEL), row.sealed);
  halves.set(new Uint16Array(plain.buffer, plain.byteOffset, DIM), j * DIM);
  j++;
}
report.inMemory = { loadSeconds: secs(t), rssGrowthMB: mb() - before };

db.close(true);
rmSync(path, { force: true });
rmSync(`${path}-wal`, { force: true });
rmSync(`${path}-shm`, { force: true });
void ids;
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
