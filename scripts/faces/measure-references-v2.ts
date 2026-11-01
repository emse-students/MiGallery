/**
 * Faces v2 DRY RUN on a COPY of the two databases (docs/wiki/face-matching-option-c.md, "Faces v2:
 * the dry run that gates the production re-match"): what the production re-match WOULD do if every
 * member's references were re-selected as face-reference-upgrade.ts does (up to 15, chosen for
 * variety among their held references and their proven faces) and the sticky-`auto` rule applied.
 * It WRITES NOTHING: both files are opened read-only, and the report is aggregate counts only - no
 * member id, no asset id, no distance per face.
 *
 * The owner's gate (2026-11-01): the production re-match runs only if this shows that NO CONFIRMED
 * photo changes member and that the lost photos go DOWN. Both are in the report:
 * - `confirmedWouldMove`: confirmed faces whose v2 decision names another member (the engine keeps
 *   a confirmed face whatever the decision; a non-zero count is still a reason to stop and look);
 * - `lost`: faces visible today (auto or confirmed) that would not be after the re-match - zero by
 *   the sticky rule, and `lostWithoutSticky` says what the rule protects;
 * - `before.none` / `after.none` and `.suggested`: the faces given to nobody, and those asked.
 * `confirmedWouldBeUnmatched` counts confirmed faces the new decision gives to nobody (kept too).
 *
 * The capture dates are NOT read (no Immich call): every proven face ranks as undated, which only
 * changes WHICH of two equally distant faces renewal would prefer, never whether a face is proven.
 *
 * Usage (on a copy, never on the live files):
 *   FACE_STORE_KEY=<the key> bun scripts/faces/measure-references-v2.ts <migallery.db> <faces.db>
 */

import { Database } from 'bun:sqlite';
import {
  FACE_AUTO_MAX_DISTANCE,
  FACE_MAX_REFERENCES,
  FACE_MODEL,
  FACE_PROVEN_AUTO_DISTANCE,
  decodeEmbedding,
  minDistance,
} from '../../src/lib/face-embedding.ts';
import { decideFace, type MemberReferences } from '../../src/lib/face-match.ts';
import {
  selectVariedReferences,
  type ReferenceItem,
} from '../../src/lib/face-reference-selection.ts';
import {
  embeddingContext,
  negativeContext,
  parseSealKey,
  referenceContext,
  unseal,
} from '../../src/lib/server/face-seal.ts';

const [mainPath, facesPath] = process.argv.slice(2);
if (!mainPath || !facesPath) {
  console.error(
    'usage: FACE_STORE_KEY=... bun scripts/faces/measure-references-v2.ts <migallery.db> <faces.db>'
  );
  process.exit(2);
}
const key = parseSealKey(process.env.FACE_STORE_KEY);
const main = new Database(mainPath, { readonly: true });
const faces = new Database(facesPath, { readonly: true });
const secs = (t: number) => Number(((performance.now() - t) / 1000).toFixed(2));
const faceKey = (assetId: string, faceIndex: number) => `${assetId}\u0000${faceIndex}`;

// 1. Every member's references and negatives, opened.
const refRows = main
  .prepare(
    'SELECT id, user_id, source, sealed FROM face_references WHERE model = ? ORDER BY user_id, id'
  )
  .all(FACE_MODEL) as Array<{ id: number; user_id: string; source: string; sealed: Uint8Array }>;
const held = new Map<string, ReferenceItem[]>();
let brokenMembers = 0;
const broken = new Set<string>();
for (const row of refRows) {
  if (broken.has(row.user_id)) continue;
  try {
    const embedding = decodeEmbedding(
      unseal(key, referenceContext(row.user_id, FACE_MODEL), row.sealed)
    );
    const list = held.get(row.user_id) ?? [];
    list.push({ key: `ref:${row.id}`, embedding, takenAt: null, anchor: row.source === 'selfie' });
    held.set(row.user_id, list);
  } catch {
    broken.add(row.user_id);
    held.delete(row.user_id);
    brokenMembers++;
  }
}
const hasNegatives = !!main
  .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'face_negatives'")
  .get();
const negatives = new Map<string, Float32Array[]>();
if (hasNegatives) {
  for (const row of main
    .prepare('SELECT user_id, sealed FROM face_negatives WHERE model = ?')
    .all(FACE_MODEL) as Array<{ user_id: string; sealed: Uint8Array }>) {
    const list = negatives.get(row.user_id) ?? [];
    list.push(decodeEmbedding(unseal(key, negativeContext(row.user_id, FACE_MODEL), row.sealed)));
    negatives.set(row.user_id, list);
  }
}

// 2. The match rows: who holds what, who rejected what.
const rows = main
  .prepare('SELECT asset_id, face_index, user_id, band, state FROM face_matches WHERE model = ?')
  .all(FACE_MODEL) as Array<{
  asset_id: string;
  face_index: number;
  user_id: string;
  band: string;
  state: string;
}>;
const holder = new Map<string, { userId: string; band: string; state: string }>();
const rejected = new Map<string, Set<string>>();
for (const r of rows) {
  const k = faceKey(r.asset_id, r.face_index);
  if (r.state === 'rejected') {
    const set = rejected.get(k) ?? new Set<string>();
    set.add(r.user_id);
    rejected.set(k, set);
  } else {
    holder.set(k, { userId: r.user_id, band: r.band, state: r.state });
  }
}

// 3. The proven faces of each member, opened: confirmed within 0.5 of a held reference, pending
//    `auto` within 0.4 (face-reference-upgrade.ts says why).
const openFace = faces.prepare(
  'SELECT sealed FROM face_embeddings WHERE asset_id = ? AND face_index = ? AND model = ?'
);
const v2 = new Map<string, ReferenceItem[]>();
const provenCounts: number[] = [];
const t0 = performance.now();
for (const [userId, items] of held) {
  const vectors = items.map((i) => i.embedding);
  const pool: ReferenceItem[] = [...items];
  let proven = 0;
  for (const r of rows) {
    if (r.user_id !== userId) continue;
    const confirmed = r.state === 'confirmed';
    if (!confirmed && !(r.state === 'pending' && r.band === 'auto')) continue;
    const blob = openFace.get(r.asset_id, r.face_index, FACE_MODEL) as {
      sealed: Uint8Array;
    } | null;
    if (!blob) continue;
    const embedding = decodeEmbedding(
      unseal(key, embeddingContext(r.asset_id, r.face_index, FACE_MODEL), blob.sealed)
    );
    const d = minDistance(vectors, embedding);
    if (!(d <= (confirmed ? FACE_AUTO_MAX_DISTANCE : FACE_PROVEN_AUTO_DISTANCE))) continue;
    proven++;
    pool.push({ key: `face:${faceKey(r.asset_id, r.face_index)}`, embedding, takenAt: null });
  }
  provenCounts.push(proven);
  v2.set(userId, selectVariedReferences(pool, FACE_MAX_REFERENCES));
}
const selectSeconds = secs(t0);

const membersOf = (sets: Map<string, ReferenceItem[]>): MemberReferences[] =>
  [...sets].map(([userId, items]) => ({
    userId,
    refs: items.map((i) => i.embedding),
    negatives: negatives.get(userId),
  }));
const before = membersOf(held);
const after = membersOf(v2);

// 4. One streamed pass over the store, deciding every face both ways.
const report = {
  members: held.size,
  brokenMembers,
  referencesBefore: [...held.values()].reduce((n, l) => n + l.length, 0),
  referencesAfter: [...v2.values()].reduce((n, l) => n + l.length, 0),
  provenPerMember: quantiles(provenCounts),
  faces: 0,
  facesFailedToOpen: 0,
  before: { auto: 0, suggested: 0, none: 0 },
  after: { auto: 0, suggested: 0, none: 0 },
  transitions: {} as Record<string, number>,
  confirmed: 0,
  confirmedWouldMove: 0,
  confirmedWouldBeUnmatched: 0,
  stickyKept: 0,
  lost: 0,
  lostWithoutSticky: 0,
  holderChanged: 0,
  seconds: { select: selectSeconds, decideBefore: 0, decideAfter: 0, scan: 0 },
};
let after_ = 0;
let tBefore = 0;
let tAfter = 0;
const tScan = performance.now();
for (;;) {
  const chunk = faces
    .prepare(
      'SELECT rowid AS rid, asset_id, face_index, sealed FROM face_embeddings WHERE model = ? AND rowid > ? ORDER BY rowid LIMIT 2000'
    )
    .all(FACE_MODEL, after_) as Array<{
    rid: number;
    asset_id: string;
    face_index: number;
    sealed: Uint8Array;
  }>;
  for (const row of chunk) {
    let embedding: Float32Array;
    try {
      embedding = decodeEmbedding(
        unseal(key, embeddingContext(row.asset_id, row.face_index, FACE_MODEL), row.sealed)
      );
    } catch {
      report.facesFailedToOpen++;
      continue;
    }
    report.faces++;
    const k = faceKey(row.asset_id, row.face_index);
    const excluded = rejected.get(k);
    let t = performance.now();
    const b = decideFace(embedding, before, excluded);
    tBefore += performance.now() - t;
    t = performance.now();
    const a = decideFace(embedding, after, excluded);
    tAfter += performance.now() - t;
    const bBand = b?.band ?? 'none';
    const aBand = a?.band ?? 'none';
    report.before[bBand]++;
    report.after[aBand]++;
    report.transitions[`${bBand}->${aBand}`] = (report.transitions[`${bBand}->${aBand}`] ?? 0) + 1;
    if (b && a && b.userId !== a.userId) report.holderChanged++;
    const now = holder.get(k);
    if (now?.state === 'confirmed') {
      report.confirmed++;
      if (a && a.userId !== now.userId) report.confirmedWouldMove++;
      if (!a) report.confirmedWouldBeUnmatched++;
      continue;
    }
    const visibleNow = now?.state === 'pending' && now.band === 'auto';
    const visibleAfter = !!a && a.band === 'auto' && a.userId === now?.userId;
    if (visibleNow && !visibleAfter) {
      // The engine keeps a pending auto face (sticky): not lost, but counted.
      report.stickyKept++;
      report.lostWithoutSticky++;
    }
  }
  if (chunk.length < 2000) break;
  after_ = chunk[chunk.length - 1].rid;
}
report.seconds.scan = secs(tScan);
report.seconds.decideBefore = Number((tBefore / 1000).toFixed(2));
report.seconds.decideAfter = Number((tAfter / 1000).toFixed(2));
// Sticky: a visible face is never lost by a re-match; `lost` stays 0 by construction, and the
// engine test "keeps an auto face ... (sticky)" is what proves it.
console.log(JSON.stringify(report, null, 2));

function quantiles(values: number[]) {
  const s = [...values].sort((a, b) => a - b);
  const q = (p: number) => (s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0);
  return { n: s.length, p10: q(0.1), p50: q(0.5), p90: q(0.9), max: s.at(-1) ?? 0 };
}
