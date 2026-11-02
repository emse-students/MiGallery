/**
 * Faces bootstrap DRY RUN on a COPY of the two databases (docs/wiki/face-matching-option-c.md, "The
 * selection rule, as the owner fixed it on 2026-11-02"): what the production selection pass WOULD do
 * to the members under FACE_MIN_REFERENCES (and to members below the cap that it would grow), with
 * every member selected first and the store then decided against the FINAL reference sets - the
 * order of the real pass. It WRITES NOTHING: both files are opened read-only, and the report is
 * aggregate counts only - no member id, no asset id, no distance per face.
 *
 * What the owner reads in it:
 * - `affected`: members the pass would change, and `referencesAdded` per member (quantiles);
 * - `addedDistanceToSelfie`: a histogram of how far each admitted reference is from the member's
 *   selfie (the drift guard is 0.62; the lookalike risk lives in the right-hand buckets);
 * - `visibleBefore` / `visibleAfter`: faces shown without a question to the affected members,
 *   `newlyVisible` per member (quantiles) and `zeroVisibleBefore` -> `zeroVisibleAfter`;
 * - `crossedMinimum`: affected members that reach 3 references (everything within 0.5 then shows);
 * - `defaultPhotoWouldBeSet`: affected members with no profile photo pointer that gain a visible face
 *   (the pass may set a default one other members see; the ledger restores it on an undo);
 * - `stolenFromOthers`: faces another member holds as `auto` today that would go to an affected
 *   member (sticky `auto` keeps them in the real engine, so this is an upper bound, and the
 *   lookalike signal).
 * Capture dates are NOT read (no Immich call): they only break ties between equal distances.
 *
 * Usage (on a copy, never on the live files):
 *   FACE_STORE_KEY=<the key> bun scripts/faces/measure-bootstrap.ts <migallery.db> <faces.db>
 */

import { Database } from 'bun:sqlite';
import {
  FACE_AMBIGUITY_MARGIN,
  FACE_AUTO_MAX_DISTANCE,
  FACE_MAX_REFERENCES,
  FACE_MIN_REFERENCES,
  FACE_MODEL,
  FACE_PROVEN_AUTO_DISTANCE,
  decodeEmbedding,
  minDistance,
} from '../../src/lib/face-embedding.ts';
import { decideFace, type MemberReferences } from '../../src/lib/face-match.ts';
import { growUntilStable, type ReferenceItem } from '../../src/lib/face-reference-selection.ts';
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
    'usage: FACE_STORE_KEY=... bun scripts/faces/measure-bootstrap.ts <migallery.db> <faces.db>'
  );
  process.exit(2);
}
const key = parseSealKey(process.env.FACE_STORE_KEY);
const main = new Database(mainPath, { readonly: true });
const faces = new Database(facesPath, { readonly: true });
const faceKey = (assetId: string, faceIndex: number) => `${assetId}\u0000${faceIndex}`;

// 1. Every member's references and negatives, opened.
const held = new Map<string, ReferenceItem[]>();
const broken = new Set<string>();
for (const row of main
  .prepare(
    'SELECT id, user_id, source, sealed FROM face_references WHERE model = ? ORDER BY user_id, id'
  )
  .all(FACE_MODEL) as Array<{ id: number; user_id: string; source: string; sealed: Uint8Array }>) {
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
  }
}
const negatives = new Map<string, Float32Array[]>();
if (
  main.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'face_negatives'").get()
) {
  for (const row of main
    .prepare('SELECT user_id, sealed FROM face_negatives WHERE model = ?')
    .all(FACE_MODEL) as Array<{ user_id: string; sealed: Uint8Array }>) {
    const list = negatives.get(row.user_id) ?? [];
    list.push(decodeEmbedding(unseal(key, negativeContext(row.user_id, FACE_MODEL), row.sealed)));
    negatives.set(row.user_id, list);
  }
}

// 2. The match rows.
const rows = main
  .prepare(
    'SELECT asset_id, face_index, user_id, band, state, runner_up, distance FROM face_matches WHERE model = ?'
  )
  .all(FACE_MODEL) as Array<{
  asset_id: string;
  face_index: number;
  user_id: string;
  band: string;
  state: string;
  runner_up: number | null;
  distance: number;
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
const rowsOf = new Map<string, typeof rows>();
for (const r of rows) {
  const list = rowsOf.get(r.user_id) ?? [];
  list.push(r);
  rowsOf.set(r.user_id, list);
}
const hasPhoto = new Set(
  (
    main
      .prepare(
        "SELECT id_user FROM users WHERE photos_asset_id IS NOT NULL AND photos_asset_id != ''"
      )
      .all() as Array<{ id_user: string }>
  ).map((u) => u.id_user)
);

// 3. Selection, member by member, against the CURRENT references (the real pass reads them too).
const openFace = faces.prepare(
  'SELECT sealed FROM face_embeddings WHERE asset_id = ? AND face_index = ? AND model = ?'
);
type Candidate = ReferenceItem & { confirmed: boolean };
const after = new Map<string, ReferenceItem[]>();
const addedPerMember: number[] = [];
const histogram: Record<string, number> = {};
const bucket = (d: number) => `${(Math.floor(d / 0.05) * 0.05).toFixed(2)}`;
let crossedMinimum = 0;
for (const [userId, items] of held) {
  if (items.length >= FACE_MAX_REFERENCES) {
    after.set(userId, items);
    continue;
  }
  const candidates: Candidate[] = [];
  const heldVectors = items.map((i) => i.embedding);
  for (const r of rowsOf.get(userId) ?? []) {
    const confirmed = r.state === 'confirmed';
    const pendingAuto = r.state === 'pending' && r.band === 'auto';
    const pendingSuggested =
      r.state === 'pending' &&
      r.band === 'suggested' &&
      (r.runner_up === null || r.runner_up - r.distance >= FACE_AMBIGUITY_MARGIN);
    if (!confirmed && !pendingAuto && !pendingSuggested) continue;
    const blob = openFace.get(r.asset_id, r.face_index, FACE_MODEL) as {
      sealed: Uint8Array;
    } | null;
    if (!blob) continue;
    const embedding = decodeEmbedding(
      unseal(key, embeddingContext(r.asset_id, r.face_index, FACE_MODEL), blob.sealed)
    );
    candidates.push({
      key: `face:${faceKey(r.asset_id, r.face_index)}`,
      embedding,
      takenAt: null,
      confirmed,
    });
  }
  const grown = growUntilStable(
    items,
    candidates,
    FACE_MAX_REFERENCES,
    (c, d) => d <= (c.confirmed ? FACE_AUTO_MAX_DISTANCE : FACE_PROVEN_AUTO_DISTANCE)
  );
  if (grown.length === 0) {
    after.set(userId, items);
    continue;
  }
  for (const g of grown) {
    const d = minDistance(heldVectors, g.embedding);
    histogram[bucket(d)] = (histogram[bucket(d)] ?? 0) + 1;
  }
  addedPerMember.push(grown.length);
  if (items.length < FACE_MIN_REFERENCES && items.length + grown.length >= FACE_MIN_REFERENCES) {
    crossedMinimum++;
  }
  after.set(userId, [...items, ...grown]);
}
const affected = new Set(
  [...after].filter(([id, list]) => list.length !== held.get(id)?.length).map(([id]) => id)
);

// 4. One streamed pass: every face decided against the FINAL sets, both ways.
const toMembers = (sets: Map<string, ReferenceItem[]>): MemberReferences[] =>
  [...sets].map(([userId, items]) => ({
    userId,
    refs: items.map((i) => i.embedding),
    negatives: negatives.get(userId),
  }));
const beforeSets = toMembers(held);
const afterSets = toMembers(after);
const visibleBefore = new Map<string, number>();
const visibleAfter = new Map<string, number>();
let stolenFromOthers = 0;
let cursor = 0;
for (;;) {
  const chunk = faces
    .prepare(
      'SELECT rowid AS rid, asset_id, face_index, sealed FROM face_embeddings WHERE model = ? AND rowid > ? ORDER BY rowid LIMIT 2000'
    )
    .all(FACE_MODEL, cursor) as Array<{
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
      continue;
    }
    const k = faceKey(row.asset_id, row.face_index);
    const excluded = rejected.get(k);
    const b = decideFace(embedding, beforeSets, excluded);
    const a = decideFace(embedding, afterSets, excluded);
    if (b && b.band === 'auto' && affected.has(b.userId)) {
      visibleBefore.set(b.userId, (visibleBefore.get(b.userId) ?? 0) + 1);
    }
    if (a && a.band === 'auto' && affected.has(a.userId)) {
      visibleAfter.set(a.userId, (visibleAfter.get(a.userId) ?? 0) + 1);
      const now = holder.get(k);
      if (now && now.userId !== a.userId && (now.state === 'confirmed' || now.band === 'auto')) {
        stolenFromOthers++;
      }
    }
  }
  if (chunk.length < 2000) break;
  cursor = chunk[chunk.length - 1].rid;
}

const ids = [...affected];
const gained = ids.map((id) => (visibleAfter.get(id) ?? 0) - (visibleBefore.get(id) ?? 0));
console.log(
  JSON.stringify(
    {
      members: held.size,
      affected: affected.size,
      referencesAdded: quantiles(addedPerMember),
      addedDistanceToSelfie: histogram,
      crossedMinimum,
      zeroVisibleBefore: ids.filter((id) => !(visibleBefore.get(id) ?? 0)).length,
      zeroVisibleAfter: ids.filter((id) => !(visibleAfter.get(id) ?? 0)).length,
      visibleBefore: quantiles(ids.map((id) => visibleBefore.get(id) ?? 0)),
      visibleAfter: quantiles(ids.map((id) => visibleAfter.get(id) ?? 0)),
      newlyVisible: quantiles(gained),
      defaultPhotoWouldBeSet: ids.filter(
        (id) => !hasPhoto.has(id) && (visibleAfter.get(id) ?? 0) > 0
      ).length,
      stolenFromOthers,
    },
    null,
    2
  )
);

function quantiles(values: number[]) {
  const s = [...values].sort((a, b) => a - b);
  const q = (p: number) => (s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0);
  return { n: s.length, p10: q(0.1), p50: q(0.5), p90: q(0.9), max: s.at(-1) ?? 0 };
}
