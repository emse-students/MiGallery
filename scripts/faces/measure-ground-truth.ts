/**
 * Ground-truth measurement for the face matcher (docs/wiki/face-matching-option-c.md, section
 * "Measurements"). Prints AGGREGATES ONLY: no id, no vector, no name ever leaves this process.
 *
 * Input on stdin: Immich's face rows in physical order, one per line, `personGroupId<TAB>[v1,...]`
 * (psql COPY text form; an empty group is `\N`). LINKED_IDS_FILE names a file of the person ids
 * members linked themselves (one per line): those are the ground truth, a member's own person.
 *
 * Usage (on the host, in a throwaway container with no network; see the wiki page for the exact
 * pipeline): bun measure-ground-truth.js < rows
 *
 * What it computes, per linked person with enough faces, for SEED draws:
 *  - REFS references drawn from the person's faces (random, and "nearest the centroid");
 *  - positives = the person's other faces, negatives = the faces of every OTHER linked person;
 *  - the minimum cosine distance of each candidate to the references, in float32 and in float16
 *    (both sides quantised through the production codec);
 *  - recall and false-match rate at the bands, and the thresholds at fixed false-match rates;
 *  - the ambiguity rule: how many positives have a runner-up member within a margin;
 *  - at scale, how many faces of persons nobody linked fall within each band per member.
 */

import { readFileSync } from 'node:fs';
import {
  FACE_AUTO_MAX_DISTANCE,
  FACE_EMBEDDING_DIM,
  FACE_SUGGEST_MAX_DISTANCE,
  decodeEmbedding,
  encodeEmbedding,
  halfToFloat,
  normalizeEmbedding,
} from '../../src/lib/face-embedding.ts';

const DIM = FACE_EMBEDDING_DIM;
const REFS = Number(process.env.REFS ?? 5);
const MIN_FACES = REFS + 3;
const SEEDS = Number(process.env.SEEDS ?? 3);
const CAP_FACES = Number(process.env.CAP_FACES ?? 40);
const SCALE_MEMBERS = Number(process.env.SCALE_MEMBERS ?? 1e9);
const MARGINS = [0.02, 0.05];

const linked = new Set(
  readFileSync(process.env.LINKED_IDS_FILE ?? '/ids', 'utf8')
    .split('\n')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
);

// ---- load -----------------------------------------------------------------------------------
const HALF_LUT = new Float32Array(65536);
for (let h = 0; h < 65536; h++) {
  HALF_LUT[h] = halfToFloat(h);
}

/** Linked faces: float32 unit vectors, grouped by person index. */
const personIndex = new Map<string, number>();
const personFaces: Float32Array[][] = [];
/** Every other face, as float16 halves, plus its norm. */
let unlinkedCap = 700_000;
let unlinked = new Uint16Array(unlinkedCap * DIM);
let unlinkedCount = 0;
let totalRows = 0;
let unclusteredRows = 0;

function parseVector(text: string): Float32Array {
  const out = new Float32Array(DIM);
  let start = 1;
  let i = 0;
  for (let p = 1; p < text.length; p++) {
    const c = text.charCodeAt(p);
    if (c === 44 || c === 93) {
      out[i++] = Number(text.slice(start, p));
      start = p + 1;
    }
  }
  if (i !== DIM) {
    throw new Error(`a vector has ${i} values`);
  }
  return out;
}

const t0 = performance.now();
const decoder = new TextDecoder();
let carry = '';
function handleLine(line: string): void {
  if (!line) {
    return;
  }
  const tab = line.indexOf('\t');
  const pid = line.slice(0, tab).toLowerCase();
  const vec = parseVector(line.slice(tab + 1));
  totalRows++;
  if (pid === '\\n') {
    unclusteredRows++;
  }
  if (linked.has(pid)) {
    let idx = personIndex.get(pid);
    if (idx === undefined) {
      idx = personFaces.length;
      personIndex.set(pid, idx);
      personFaces.push([]);
    }
    personFaces[idx].push(normalizeEmbedding(vec));
    return;
  }
  if (unlinkedCount === unlinkedCap) {
    unlinkedCap *= 2;
    const grown = new Uint16Array(unlinkedCap * DIM);
    grown.set(unlinked);
    unlinked = grown;
  }
  const bytes = encodeEmbedding(vec);
  unlinked.set(new Uint16Array(bytes.buffer, bytes.byteOffset, DIM), unlinkedCount * DIM);
  unlinkedCount++;
}
for await (const chunk of Bun.stdin.stream()) {
  carry += decoder.decode(chunk, { stream: true });
  let nl = carry.indexOf('\n');
  while (nl >= 0) {
    handleLine(carry.slice(0, nl));
    carry = carry.slice(nl + 1);
    nl = carry.indexOf('\n');
  }
}
handleLine(carry);
const loadSeconds = (performance.now() - t0) / 1000;

// ---- helpers --------------------------------------------------------------------------------
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < DIM; i++) {
    s += a[i] * b[i];
  }
  return s;
}

/** float16 round trip of a unit vector, through the production codec. */
function quantise(v: Float32Array): Float32Array {
  return normalizeEmbedding(decodeEmbedding(encodeEmbedding(v)));
}

function minDist(refs: Float32Array[], c: Float32Array): number {
  let best = 2;
  for (const r of refs) {
    const d = 1 - dot(r, c);
    if (d < best) {
      best = d;
    }
  }
  return Math.max(0, best);
}

function pickRandom(faces: Float32Array[], rand: () => number, n = REFS): number[] {
  const idx = faces.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx.slice(0, n);
}

function pickCentroid(faces: Float32Array[]): number[] {
  const c = new Float32Array(DIM);
  for (const f of faces) {
    for (let i = 0; i < DIM; i++) {
      c[i] += f[i];
    }
  }
  return faces
    .map((f, i) => ({ i, d: -dot(f, c) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, REFS)
    .map((x) => x.i);
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) {
    return NaN;
  }
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

/** Smallest threshold whose false-match rate stays at or below `fmr`, and the recall there. */
function atFmr(pos: number[], neg: number[], fmr: number): { threshold: number; recall: number } {
  const allowed = Math.floor(fmr * neg.length);
  const threshold = allowed < neg.length ? neg[allowed] - 1e-9 : 2;
  return { threshold, recall: pos.filter((d) => d <= threshold).length / pos.length };
}

const round = (x: number, n = 4) => Number(x.toFixed(n));

// ---- the ground-truth protocol --------------------------------------------------------------
const eligible = personFaces.map((f, i) => ({ f, i })).filter((p) => p.f.length >= MIN_FACES);

interface Run {
  pos32: number[];
  neg32: number[];
  pos16: number[];
  neg16: number[];
  maxAbsDiff: number;
  sumAbsDiff: number;
  pairs: number;
  bandFlips: number;
  ambiguousPositives: Record<string, number>;
  autoPositives: number;
  negBeatenByOwner: number;
  negAtSuggest: number;
}

function band(d: number): number {
  return d <= FACE_AUTO_MAX_DISTANCE ? 0 : d <= FACE_SUGGEST_MAX_DISTANCE ? 1 : 2;
}

function runProtocol(seed: number, selection: 'random' | 'centroid'): Run {
  const rand = rng(seed);
  const refs32 = eligible.map(({ f }) =>
    (selection === 'random' ? pickRandom(f, rand) : pickCentroid(f)).map((k) => f[k])
  );
  const refSets = refs32.map((rs) => new Set(rs));
  const refs16 = refs32.map((rs) => rs.map(quantise));
  const run: Run = {
    pos32: [],
    neg32: [],
    pos16: [],
    neg16: [],
    maxAbsDiff: 0,
    sumAbsDiff: 0,
    pairs: 0,
    bandFlips: 0,
    ambiguousPositives: Object.fromEntries(MARGINS.map((m) => [String(m), 0])),
    autoPositives: 0,
    negBeatenByOwner: 0,
    negAtSuggest: 0,
  };
  for (let owner = 0; owner < eligible.length; owner++) {
    // At most CAP_FACES candidates per person, drawn at random among the non-references.
    const pool = eligible[owner].f.filter((face) => !refSets[owner].has(face));
    const sample = pickRandom(pool, rand, CAP_FACES).map((k) => pool[k]);
    for (const face of sample) {
      const face16 = quantise(face);
      const ownerD = minDist(refs16[owner], face16);
      // Every member's distance to this face: the owner's is a positive, the others negatives.
      let best = 2;
      let second = 2;
      for (let m = 0; m < eligible.length; m++) {
        const d32 = minDist(refs32[m], face);
        const d16 = m === owner ? ownerD : minDist(refs16[m], face16);
        const diff = Math.abs(d32 - d16);
        run.maxAbsDiff = Math.max(run.maxAbsDiff, diff);
        run.sumAbsDiff += diff;
        run.pairs++;
        if (band(d32) !== band(d16)) {
          run.bandFlips++;
        }
        if (m === owner) {
          run.pos32.push(d32);
          run.pos16.push(d16);
        } else {
          run.neg32.push(d32);
          run.neg16.push(d16);
          if (d16 <= FACE_SUGGEST_MAX_DISTANCE) {
            run.negAtSuggest++;
            if (ownerD < d16) {
              run.negBeatenByOwner++;
            }
          }
        }
        if (d16 < best) {
          second = best;
          best = d16;
        } else if (d16 < second) {
          second = d16;
        }
      }
      if (ownerD <= FACE_AUTO_MAX_DISTANCE && ownerD === best) {
        run.autoPositives++;
        for (const margin of MARGINS) {
          if (second - best < margin) {
            run.ambiguousPositives[String(margin)]++;
          }
        }
      }
    }
  }
  return run;
}

function summarise(run: Run) {
  const sets = { float32: [run.pos32, run.neg32], float16: [run.pos16, run.neg16] } as const;
  const out: Record<string, unknown> = {};
  for (const [name, [posRaw, negRaw]] of Object.entries(sets)) {
    const pos = [...posRaw].sort((a, b) => a - b);
    const neg = [...negRaw].sort((a, b) => a - b);
    const at = (t: number) => ({
      recall: round(pos.filter((d) => d <= t).length / pos.length),
      falseMatchPerPair: neg.filter((d) => d <= t).length / neg.length,
      falseMatches: neg.filter((d) => d <= t).length,
    });
    out[name] = {
      positives: pos.length,
      negatives: neg.length,
      at050: at(FACE_AUTO_MAX_DISTANCE),
      at062: at(FACE_SUGGEST_MAX_DISTANCE),
      fmr1e3: Object.fromEntries(
        Object.entries(atFmr(pos, neg, 1e-3)).map(([k, v]) => [k, round(v)])
      ),
      fmr1e4: Object.fromEntries(
        Object.entries(atFmr(pos, neg, 1e-4)).map(([k, v]) => [k, round(v)])
      ),
      fmr1e5: Object.fromEntries(
        Object.entries(atFmr(pos, neg, 1e-5)).map(([k, v]) => [k, round(v)])
      ),
      positiveDistanceP50P90P99: [0.5, 0.9, 0.99].map((q) => round(quantile(pos, q))),
      negativeDistanceP0001P001P01: [0.0001, 0.001, 0.01].map((q) => round(quantile(neg, q))),
    };
  }
  out.float16VsFloat32 = {
    pairs: run.pairs,
    maxAbsDistanceDiff: run.maxAbsDiff,
    meanAbsDistanceDiff: run.sumAbsDiff / run.pairs,
    bandFlips: run.bandFlips,
  };
  out.ambiguity = {
    autoAcceptedPositives: run.autoPositives,
    runnerUpWithinMargin: run.ambiguousPositives,
    falseMatchesAt062: run.negAtSuggest,
    falseMatchesWhereTheTrueOwnerIsCloser: run.negBeatenByOwner,
  };
  return out;
}

// ---- at scale: what the suggested band would show from faces nobody linked -------------------
function scale(seed: number) {
  const rand = rng(seed);
  const members = eligible.slice(0, SCALE_MEMBERS);
  const refs = members.map(({ f }) => pickCentroid(f).map((k) => quantise(f[k])));
  void rand;
  const auto: number[] = Array.from({ length: members.length }, () => 0);
  const suggested: number[] = Array.from({ length: members.length }, () => 0);
  const ambiguousAuto: number[] = Array.from({ length: members.length }, () => 0);
  const cand = new Float32Array(DIM);
  const t = performance.now();
  for (let k = 0; k < unlinkedCount; k++) {
    let norm = 0;
    const base = k * DIM;
    for (let i = 0; i < DIM; i++) {
      const v = HALF_LUT[unlinked[base + i]];
      cand[i] = v;
      norm += v * v;
    }
    const inv = 1 / Math.sqrt(norm);
    let best = 2;
    let bestM = -1;
    let second = 2;
    for (let m = 0; m < members.length; m++) {
      let md = 2;
      for (const r of refs[m]) {
        const d = 1 - dot(r, cand) * inv;
        if (d < md) {
          md = d;
        }
      }
      if (md <= FACE_AUTO_MAX_DISTANCE) {
        auto[m]++;
      } else if (md <= FACE_SUGGEST_MAX_DISTANCE) {
        suggested[m]++;
      }
      if (md < best) {
        second = best;
        best = md;
        bestM = m;
      } else if (md < second) {
        second = md;
      }
    }
    if (bestM >= 0 && best <= FACE_AUTO_MAX_DISTANCE && second - best < MARGINS[0]) {
      ambiguousAuto[bestM]++;
    }
  }
  const dist = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    return {
      total: xs.reduce((a, b) => a + b, 0),
      p50: quantile(s, 0.5),
      p90: quantile(s, 0.9),
      max: s[s.length - 1],
    };
  };
  return {
    members: members.length,
    unlinkedFaces: unlinkedCount,
    seconds: round((performance.now() - t) / 1000, 1),
    autoPerMember: dist(auto),
    suggestedPerMember: dist(suggested),
    autoWithRunnerUpWithin002: dist(ambiguousAuto),
  };
}

const facesPerPerson = eligible.map((p) => p.f.length).sort((a, b) => a - b);
const report: Record<string, unknown> = {
  input: {
    rows: totalRows,
    unclusteredRows,
    linkedIds: linked.size,
    linkedPersonsWithFaces: personFaces.length,
    eligiblePersons: eligible.length,
    linkedFaces: personFaces.reduce((a, f) => a + f.length, 0),
    facesPerEligiblePersonP10P50P90: [0.1, 0.5, 0.9].map((q) => quantile(facesPerPerson, q)),
    unlinkedFaces: unlinkedCount,
    loadSeconds: round(loadSeconds, 1),
    rssMBAfterLoad: Math.round(process.memoryUsage().rss / 1e6),
  },
};
const random = [];
for (let s = 1; s <= SEEDS; s++) {
  const t = performance.now();
  random.push({
    seed: s,
    ...summarise(runProtocol(s, 'random')),
    seconds: round((performance.now() - t) / 1000, 1),
  });
}
report.randomReferences = random;
report.centroidReferences = summarise(runProtocol(0, 'centroid'));
if (process.env.SKIP_SCALE !== '1') {
  report.scale = scale(0);
}
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
