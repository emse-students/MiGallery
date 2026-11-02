/**
 * Faces selection-pass DRY RUN on a COPY of the two databases (docs/wiki/face-matching-option-c.md,
 * "The selection rule, as the owner fixed it on 2026-11-02"): what the production passes WOULD do,
 * simulated until nothing changes. It WRITES NOTHING: both files are opened read-only, and the
 * report is aggregate counts only - no member id, no asset id, no distance per face.
 *
 * THE SIMULATION follows face-reference-upgrade.ts, not a summary of it:
 * - the population is the members the tick would select for: under FACE_MIN_REFERENCES whatever
 *   their marker, or below the marker's version; never an UNDONE member; a member at the minimum
 *   whose marker is current is left alone; a member below the cap grows (most similar first, the
 *   drift guard measured to the SELFIE); an UNMARKED member at the cap is propagated by variety
 *   among PROVEN faces only; a MARKED member at the cap is only marked (never re-propagated);
 * - faces a member already holds as references are never candidates again;
 * - every member is selected first, then every face of the store is decided against the FINAL
 *   reference sets (two phases), the sticky `auto` rule keeps a face with the member who shows it,
 *   and the decided rows feed the NEXT pass: passes repeat until no member changes (at most
 *   MAX_PASSES; `passes` reports how many it took, `converged` whether it stopped by itself).
 * Capture dates are NOT read (no Immich call): they only break ties between equal distances.
 *
 * EVERYTHING IS SPLIT BY STARTING CLASS: `under3` (fewer than 3 references), `below_cap` (3 to 14),
 * `at_cap` (15). `unsealFailures` counts the members dropped because a reference would not open
 * (they are never selected for), and `facesFailedToOpen` the stored faces that would not.
 * Per class: `members`, `affected`, `referencesAdded` and `addedDistanceToSelfie` (a histogram of
 * how far each admitted reference lies from the selfie: the lookalike risk lives on the right),
 * `crossedMinimum` (reach 3 references: everything within 0.5 then shows), `zeroVisible` before
 * and after, `visible` before and after, `newlyVisible` per member, `defaultPhotoWouldBeSet` and
 * (the sticky `auto` rule means a face a member already shows without a question never moves).
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
  FACE_REFERENCE_SELECTION_VERSION,
  FACE_SELECTION_UNDONE,
  FACE_SUGGEST_MAX_DISTANCE,
  decodeEmbedding,
  minDistance,
} from '../../src/lib/face-embedding.ts';
import { decideFace, type MemberReferences } from '../../src/lib/face-match.ts';
import {
  growUntilStable,
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

const MAX_PASSES = 6;
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
type Klass = 'under3' | 'below_cap' | 'at_cap';
const klassOf = (n: number): Klass =>
  n < FACE_MIN_REFERENCES ? 'under3' : n < FACE_MAX_REFERENCES ? 'below_cap' : 'at_cap';
const KLASSES: Klass[] = ['under3', 'below_cap', 'at_cap'];

// 1. Every member's references, markers and negatives, opened.
interface Held extends ReferenceItem {
  source: string;
  face: string | null;
}
const held = new Map<string, Held[]>();
const broken = new Set<string>();
for (const row of main
  .prepare(
    'SELECT id, user_id, source, sealed, asset_id, face_index FROM face_references WHERE model = ? ORDER BY user_id, id'
  )
  .all(FACE_MODEL) as Array<{
  id: number;
  user_id: string;
  source: string;
  sealed: Uint8Array;
  asset_id: string | null;
  face_index: number | null;
}>) {
  if (broken.has(row.user_id)) continue;
  try {
    const embedding = decodeEmbedding(
      unseal(key, referenceContext(row.user_id, FACE_MODEL), row.sealed)
    );
    const list = held.get(row.user_id) ?? [];
    list.push({
      key: `ref:${row.id}`,
      embedding,
      takenAt: null,
      anchor: row.source === 'selfie',
      source: row.source,
      face: row.asset_id === null ? null : faceKey(row.asset_id, row.face_index ?? 0),
    });
    held.set(row.user_id, list);
  } catch {
    broken.add(row.user_id);
    held.delete(row.user_id);
  }
}
const marker = new Map<string, number>(
  (
    main
      .prepare('SELECT user_id, version FROM face_reference_selection WHERE model = ?')
      .all(FACE_MODEL) as Array<{ user_id: string; version: number }>
  ).map((r) => [r.user_id, r.version])
);
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
const hasPhoto = new Set(
  (
    main
      .prepare(
        "SELECT id_user FROM users WHERE photos_asset_id IS NOT NULL AND photos_asset_id != ''"
      )
      .all() as Array<{ id_user: string }>
  ).map((u) => u.id_user)
);

// 2. The match rows: the state the passes start from, and that they update.
interface Row {
  userId: string;
  band: string;
  state: string;
  distance: number;
  runnerUp: number | null;
}
const sim = new Map<string, Row>();
const rejected = new Map<string, Set<string>>();
for (const r of main
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
}>) {
  const k = faceKey(r.asset_id, r.face_index);
  if (r.state === 'rejected') {
    const set = rejected.get(k) ?? new Set<string>();
    set.add(r.user_id);
    rejected.set(k, set);
  } else {
    sim.set(k, {
      userId: r.user_id,
      band: r.band,
      state: r.state,
      distance: r.distance,
      runnerUp: r.runner_up,
    });
  }
}
const visibleOf = (rows: Iterable<Row>): Map<string, number> => {
  const out = new Map<string, number>();
  for (const r of rows) {
    if (r.state === 'confirmed' || (r.state === 'pending' && r.band === 'auto')) {
      out.set(r.userId, (out.get(r.userId) ?? 0) + 1);
    }
  }
  return out;
};
const visibleBefore = visibleOf(sim.values());

const openFace = faces.prepare(
  'SELECT sealed FROM face_embeddings WHERE asset_id = ? AND face_index = ? AND model = ?'
);
const startClass = new Map<string, Klass>([...held].map(([id, l]) => [id, klassOf(l.length)]));

// 3. One member's selection, as reselectReferences does it. Returns the added items.
type Candidate = ReferenceItem & { confirmed: boolean };
/** What the guard and the ranking are measured to: the selfie, else the references no pass added. */
const yardstickOf = (items: Held[]) => {
  const selfies = items.filter((i) => i.source === 'selfie');
  const originals = items.filter((i) => i.source !== 'matched');
  return selfies.length > 0 ? selfies : originals.length > 0 ? originals : items;
};
const selfieDistance = (items: Held[], v: ArrayLike<number>) =>
  minDistance(
    yardstickOf(items).map((i) => i.embedding),
    v
  );
const guardOf = (c: { confirmed?: boolean }) =>
  c.confirmed ? FACE_SUGGEST_MAX_DISTANCE : FACE_AUTO_MAX_DISTANCE;
type Selection =
  | { kind: 'none' }
  | { kind: 'mark' }
  | { kind: 'change'; added: Candidate[]; keep: Held[] };
function selectFor(userId: string, items: Held[], rowsOf: Map<string, string[]>): Selection {
  const m = marker.get(userId);
  if (m === FACE_SELECTION_UNDONE) return { kind: 'none' };
  const growing = items.length < FACE_MAX_REFERENCES;
  const current = m !== undefined && m >= FACE_REFERENCE_SELECTION_VERSION;
  if (current && items.length >= FACE_MIN_REFERENCES) return { kind: 'none' };
  // Marked at the cap: only marked, never touched.
  if (m !== undefined && !growing) return { kind: 'mark' };
  // The bootstrap (an unconfirmed suggestion counts as proof) is the lone-selfie case only.
  const bootstrap = items.length < FACE_MIN_REFERENCES;
  const heldFaces = new Set(items.map((i) => i.face).filter((f): f is string => f !== null));
  const candidates: Candidate[] = [];
  for (const k of rowsOf.get(userId) ?? []) {
    if (heldFaces.has(k)) continue;
    const r = sim.get(k);
    if (!r) continue;
    const confirmed = r.state === 'confirmed';
    const pendingAuto = r.state === 'pending' && r.band === 'auto';
    const pendingSuggested =
      bootstrap &&
      r.state === 'pending' &&
      r.band === 'suggested' &&
      (r.runnerUp === null || r.runnerUp - r.distance >= FACE_AMBIGUITY_MARGIN);
    if (!confirmed && !pendingAuto && !pendingSuggested) continue;
    const [assetId, faceIndex] = k.split('\u0000');
    const blob = openFace.get(assetId, Number(faceIndex), FACE_MODEL) as {
      sealed: Uint8Array;
    } | null;
    if (!blob) continue;
    const embedding = decodeEmbedding(
      unseal(key, embeddingContext(assetId, Number(faceIndex), FACE_MODEL), blob.sealed)
    );
    candidates.push({ key: `face:${k}`, embedding, takenAt: null, confirmed });
  }
  const bound = (c: Candidate, d: number) =>
    d <= (c.confirmed ? FACE_AUTO_MAX_DISTANCE : FACE_PROVEN_AUTO_DISTANCE);
  const yardstick = yardstickOf(items);
  if (growing) {
    const grown = growUntilStable(items, candidates, FACE_MAX_REFERENCES, bound, {
      yardstick,
      guard: guardOf,
    });
    if (grown.length === 0)
      return items.length >= FACE_MIN_REFERENCES ? { kind: 'mark' } : { kind: 'none' };
    return { kind: 'change', added: grown, keep: items };
  }
  const heldVectors = items.map((i) => i.embedding);
  const anchorVectors = yardstick.map((i) => i.embedding);
  const pool: ReferenceItem[] = [...items];
  for (const c of candidates) {
    if (
      bound(c, minDistance(heldVectors, c.embedding)) &&
      minDistance(anchorVectors, c.embedding) <= guardOf(c)
    ) {
      pool.push(c);
    }
  }
  const chosen = new Set(selectVariedReferences(pool, FACE_MAX_REFERENCES).map((c) => c.key));
  // The real pass writes (and marks) even when the chosen set equals the held one.
  return {
    kind: 'change',
    added: candidates.filter((c) => chosen.has(c.key)),
    keep: items.filter((i) => chosen.has(i.key)),
  };
}

// 4. The passes, until stable.
interface Stat {
  members: number;
  affected: Set<string>;
  added: number[];
  histogram: Record<string, number>;
  crossed: number;
  dropped: number;
}
const stats = Object.fromEntries(
  KLASSES.map((k) => [
    k,
    { members: 0, affected: new Set(), added: [], histogram: {}, crossed: 0, dropped: 0 } as Stat,
  ])
) as Record<Klass, Stat>;
for (const [id, k] of startClass) {
  if (marker.get(id) !== FACE_SELECTION_UNDONE) stats[k].members++;
}
// An epsilon, so 0.15 (which the float 0.15000000000000002 / 0.05 floors to 3) is not 0.10.
const bucket = (d: number) => (Math.floor(d / 0.05 + 1e-9) * 0.05).toFixed(2);
const refs = new Map<string, Held[]>([...held].map(([id, l]) => [id, [...l]]));
const addedTotal = new Map<string, number>();
let passes = 0;
let converged = false;
let facesFailedToOpen = 0;
for (; passes < MAX_PASSES;) {
  passes++;
  const rowsOf = new Map<string, string[]>();
  for (const [k, r] of sim) {
    const list = rowsOf.get(r.userId) ?? [];
    list.push(k);
    rowsOf.set(r.userId, list);
  }
  const changedMembers = new Set<string>();
  for (const [userId, items] of refs) {
    const result = selectFor(userId, items, rowsOf);
    if (result.kind === 'none') continue;
    // Production marks the member selected in both cases, and never selects for them again.
    marker.set(userId, FACE_REFERENCE_SELECTION_VERSION);
    if (result.kind === 'mark') continue;
    const { added, keep } = result;
    const dropped = items.length - keep.length;
    const start = startClass.get(userId) as Klass;
    const before = items.length;
    for (const a of added) {
      const d = selfieDistance(items, a.embedding);
      const h = stats[start].histogram;
      h[bucket(d)] = (h[bucket(d)] ?? 0) + 1;
    }
    changedMembers.add(userId);
    if (added.length > 0 || dropped > 0) {
      stats[start].affected.add(userId);
      addedTotal.set(userId, (addedTotal.get(userId) ?? 0) + added.length);
      stats[start].dropped += dropped;
      if (before < FACE_MIN_REFERENCES && before + added.length >= FACE_MIN_REFERENCES) {
        stats[start].crossed++;
      }
    }
    const addedHeld: Held[] = added.map((a) => ({
      ...a,
      source: 'matched',
      face: a.key.slice('face:'.length),
    }));
    refs.set(userId, [...keep, ...addedHeld]);
  }
  if (changedMembers.size === 0) {
    converged = true;
    break;
  }
  // The faces production re-decides: those within the suggestion bound of a RE-MATCHED member's
  // references, and those such a member holds (rematchMember), not every face of the store.
  const changedVectors = [...changedMembers].flatMap((id) =>
    (refs.get(id) ?? []).map((i) => i.embedding)
  );
  // Phase 2: every face of the store, decided against the FINAL sets of this pass.
  const members: MemberReferences[] = [...refs].map(([userId, items]) => ({
    userId,
    refs: items.map((i) => i.embedding),
    negatives: negatives.get(userId),
  }));
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
        if (passes === 1) facesFailedToOpen++;
        continue;
      }
      const k = faceKey(row.asset_id, row.face_index);
      const now = sim.get(k);
      if (
        !(now && changedMembers.has(now.userId)) &&
        !(
          changedVectors.length > 0 &&
          minDistance(changedVectors, embedding) <= FACE_SUGGEST_MAX_DISTANCE
        )
      ) {
        continue;
      }
      // A confirmed face stays; a face shown without a question stays with who shows it (sticky).
      if (now && (now.state === 'confirmed' || (now.state === 'pending' && now.band === 'auto'))) {
        continue;
      }
      const decision = decideFace(embedding, members, rejected.get(k));
      if (!decision) {
        sim.delete(k);
        continue;
      }
      sim.set(k, {
        userId: decision.userId,
        band: decision.band,
        state: 'pending',
        distance: decision.distance,
        runnerUp: decision.runnerUp,
      });
    }
    if (chunk.length < 2000) break;
    cursor = chunk[chunk.length - 1].rid;
  }
}
const visibleAfter = visibleOf(sim.values());
// Faces by band at the end, per starting class: shown without a question (`auto`, within 0.5),
// waiting for an answer (`suggested`, 0.5 to 0.62), and answered `confirmed`.
const bandCounts = (rowsOfAll: Iterable<Row>, ids: Set<string>) => {
  const out = { auto: 0, suggested: 0, confirmed: 0 };
  for (const r of rowsOfAll) {
    if (!ids.has(r.userId)) continue;
    if (r.state === 'confirmed') out.confirmed++;
    else if (r.band === 'auto') out.auto++;
    else out.suggested++;
  }
  return out;
};
const initialRows = new Map<string, Row>();
for (const r of main
  .prepare(
    "SELECT asset_id, face_index, user_id, band, state, runner_up, distance FROM face_matches WHERE model = ? AND state != 'rejected'"
  )
  .all(FACE_MODEL) as Array<{
  asset_id: string;
  face_index: number;
  user_id: string;
  band: string;
  state: string;
  runner_up: number | null;
  distance: number;
}>) {
  initialRows.set(faceKey(r.asset_id, r.face_index), {
    userId: r.user_id,
    band: r.band,
    state: r.state,
    distance: r.distance,
    runnerUp: r.runner_up,
  });
}

// 5. The report.
const report: Record<string, unknown> = {
  passes,
  converged,
  membersWithReferences: held.size,
  unsealFailures: broken.size,
  facesFailedToOpen,
  undoneMembers: [...marker.values()].filter((v) => v === FACE_SELECTION_UNDONE).length,
};
for (const k of KLASSES) {
  const s = stats[k];
  const ids = [...s.affected];
  const all = [...startClass]
    .filter(([id, c]) => c === k && marker.get(id) !== FACE_SELECTION_UNDONE)
    .map(([id]) => id);
  report[k] = {
    members: s.members,
    affected: ids.length,
    referencesAdded: quantiles(ids.map((id) => addedTotal.get(id) ?? 0)),
    referencesDropped: s.dropped,
    addedDistanceToSelfie: s.histogram,
    crossedMinimum: s.crossed,
    facesBefore: bandCounts(initialRows.values(), new Set(all)),
    facesAfter: bandCounts(sim.values(), new Set(all)),
    zeroVisibleBefore: all.filter((id) => !(visibleBefore.get(id) ?? 0)).length,
    zeroVisibleAfter: all.filter((id) => !(visibleAfter.get(id) ?? 0)).length,
    visibleBefore: quantiles(all.map((id) => visibleBefore.get(id) ?? 0)),
    visibleAfter: quantiles(all.map((id) => visibleAfter.get(id) ?? 0)),
    newlyVisible: quantiles(
      ids.map((id) => (visibleAfter.get(id) ?? 0) - (visibleBefore.get(id) ?? 0))
    ),
    defaultPhotoWouldBeSet: ids.filter((id) => !hasPhoto.has(id) && (visibleAfter.get(id) ?? 0) > 0)
      .length,
  };
}
console.log(JSON.stringify(report, null, 2));

function quantiles(values: number[]) {
  const s = [...values].sort((a, b) => a - b);
  const q = (p: number) => (s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0);
  return { n: s.length, p10: q(0.1), p50: q(0.5), p90: q(0.9), max: s.at(-1) ?? 0 };
}
