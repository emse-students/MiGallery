#!/usr/bin/env bun
/**
 * Lot A7: drive the one-shot seed of the face store (src/lib/server/face-seed.ts) from Immich's
 * own vectors. Reads, on stdin, the three COPY exports of docs/wiki/face-matching-option-c.md
 * ("A7 - the seed"), tab-separated, in PHYSICAL order:
 *
 *   C <assets> <faces>                               FIRST: what Immich counted before streaming
 *   A <asset id>                                     every asset face recognition ran on
 *   F <asset id> <person id|\N> <w> <h> <x1> <y1> <x2> <y2> <[v1,...,v512]>   every visible face
 *
 * and posts them in batches to POST /api/admin/faces/seed: `begin` (which answers the run token
 * every later phase carries), the `assets`, the `faces`, then a DRY-RUN `finish` whose report is
 * printed, then the real `finish` - unless `--dry-run` is given, which stops after the dry run and
 * seals nothing. Each finish answers at once and runs on the server; the client polls
 * GET /api/admin/faces/seed?run=<token> until it is done or failed. The server refuses to seal
 * (`incomplete`) unless the counts of the `C` line equal what it received, so a truncated export
 * (psql failing mid-COPY) is never sealed; an input without its `C` line exits non-zero.
 *
 * Nothing is written to disk: the vectors go from Immich's database to the sealed store through
 * memory only. Prints the reports, which carry aggregates only.
 *
 * Environment: MIGALLERY_URL (default http://127.0.0.1:3000), MIGALLERY_ADMIN_KEY (an admin API key).
 * Run inside the MiGallery container: `... | docker exec -i -e MIGALLERY_ADMIN_KEY <container>
 * bun scripts/faces/seed-client.mjs [--dry-run]`.
 */

const BASE = process.env.MIGALLERY_URL || 'http://127.0.0.1:3000';
const KEY = process.env.MIGALLERY_ADMIN_KEY || '';
const FACE_BATCH = 2000;
const ASSET_BATCH = 20000;
/** Between two polls of a running finish: a cadence, never a deadline (the outcome is durable). */
const POLL_MS = 5000;

/**
 * The JSON of a response, or a throw naming the step and the status.
 * @param {Response} res
 * @param {string} what
 */
async function answer(res, what) {
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${what}: HTTP ${res.status} ${text.slice(0, 300)}`);
  }
  return JSON.parse(text);
}

/** @param {{ phase: string } & Record<string, unknown>} body */
async function post(body) {
  const res = await fetch(`${BASE}/api/admin/faces/seed`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': KEY },
    body: JSON.stringify(body),
  });
  return answer(res, body.phase);
}

/**
 * Start a finish (or its dry run) and poll its durable status until it is done or failed.
 * @param {string} run
 * @param {{ assets: number, faces: number }} expected
 * @param {boolean} dryRun
 */
async function finish(run, expected, dryRun) {
  await post({ phase: 'finish', run, expected, dryRun });
  for (;;) {
    await Bun.sleep(POLL_MS);
    const res = await fetch(`${BASE}/api/admin/faces/seed?run=${encodeURIComponent(run)}`, {
      headers: { 'x-api-key': KEY },
    });
    const status = await answer(res, 'poll');
    if (status.status === 'done') {
      return status.report;
    }
    if (status.status === 'failed') {
      throw new Error(`${dryRun ? 'the dry run' : 'the finish'} failed: ${status.reason}`);
    }
    if (status.status !== 'running') {
      throw new Error(`the finish is not recorded (status ${status.status})`);
    }
  }
}

const WHOLE = /^\d+$/;

/**
 * The `C` line - what Immich counted before the export streamed - as the finish expects it;
 * throws on a line that is not one.
 * @param {string[]} cols
 */
export function parseCountLine(cols) {
  if (cols.length !== 3 || cols[0] !== 'C') {
    throw new Error('the first input line must be the count line: C <assets> <faces>');
  }
  if (!WHOLE.test(cols[1]) || !WHOLE.test(cols[2])) {
    throw new Error('the count line has a count that is not a whole number');
  }
  return { assets: Number(cols[1]), faces: Number(cols[2]) };
}

/**
 * One `F` line as the route expects it; throws on a line that is not one.
 * @param {string[]} cols
 */
export function parseFaceLine(cols) {
  if (cols.length !== 10) {
    throw new Error(`a face line has ${cols.length} columns, expected 10`);
  }
  const [, assetId, person, w, h, x1, y1, x2, y2, vector] = cols;
  const ints = [w, h, x1, y1, x2, y2].map((v) => Number.parseInt(v, 10));
  if (ints.some((v) => !Number.isInteger(v))) {
    throw new Error('a face line has a non-integer box or size');
  }
  if (!vector.startsWith('[') || !vector.endsWith(']')) {
    throw new Error('a face line has no vector');
  }
  return {
    assetId,
    personId: person === '\\N' ? null : person,
    imageWidth: ints[0],
    imageHeight: ints[1],
    x1: ints[2],
    y1: ints[3],
    x2: ints[4],
    y2: ints[5],
    embedding: vector.slice(1, -1).split(',').map(Number),
  };
}

async function main() {
  if (!KEY) {
    throw new Error('MIGALLERY_ADMIN_KEY is required');
  }
  const dryRunOnly = process.argv.includes('--dry-run');
  const started = Date.now();
  const { run } = await post({ phase: 'begin' });
  /** @type {{ assets: number, faces: number } | null} */
  let expected = null;
  /** @type {string[]} */
  let assets = [];
  /** @type {ReturnType<typeof parseFaceLine>[]} */
  let faces = [];
  const totals = { assets: 0, faces: 0, linked: 0, unusable: 0 };
  const flushAssets = async () => {
    if (assets.length > 0) {
      await post({ phase: 'assets', run, ids: assets });
      totals.assets += assets.length;
      assets = [];
    }
  };
  const flushFaces = async () => {
    if (faces.length > 0) {
      const r = await post({ phase: 'faces', run, faces });
      totals.faces += r.written;
      totals.linked += r.linked;
      totals.unusable += r.unusable;
      faces = [];
      if (totals.faces % 50000 < FACE_BATCH) {
        console.error(`... ${totals.faces} faces (${Math.round((Date.now() - started) / 1000)} s)`);
      }
    }
  };

  let rest = '';
  const decoder = new TextDecoder();
  for await (const chunk of Bun.stdin.stream()) {
    rest += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = rest.indexOf('\n')) >= 0) {
      const line = rest.slice(0, nl);
      rest = rest.slice(nl + 1);
      if (!line) {
        continue;
      }
      const cols = line.split('\t');
      if (!expected) {
        expected = parseCountLine(cols);
        console.error(`Immich counted ${expected.assets} assets and ${expected.faces} faces`);
      } else if (cols[0] === 'A' && cols.length === 2) {
        assets.push(cols[1]);
        if (assets.length >= ASSET_BATCH) {
          await flushAssets();
        }
      } else if (cols[0] === 'F') {
        await flushAssets();
        faces.push(parseFaceLine(cols));
        if (faces.length >= FACE_BATCH) {
          await flushFaces();
        }
      } else {
        throw new Error(`an input line is neither an asset nor a face (${cols.length} columns)`);
      }
    }
  }
  if (rest.trim()) {
    throw new Error('the input ends in the middle of a line');
  }
  if (!expected) {
    throw new Error('the input has no count line: the export did not run');
  }
  await flushAssets();
  await flushFaces();
  console.error(`sent: ${JSON.stringify(totals)}; dry run of the finish...`);
  const plan = await finish(run, expected, true);
  console.log(JSON.stringify({ dryRun: true, ...plan }));
  if (dryRunOnly) {
    console.error('--dry-run: nothing sealed; run again without it to seed');
    return;
  }
  console.error('deciding every face...');
  const report = await finish(run, expected, false);
  console.log(JSON.stringify({ seconds: Math.round((Date.now() - started) / 1000), ...report }));
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(`seed failed: ${e.message}`);
    process.exit(1);
  });
}
