#!/usr/bin/env bun
/**
 * Lot A7: drive the one-shot seed of the face store (src/lib/server/face-seed.ts) from Immich's
 * own vectors. Reads, on stdin, the two COPY exports of docs/wiki/face-matching-option-c.md
 * ("A7 - the seed"), tab-separated, in PHYSICAL order:
 *
 *   A <asset id>                                     every asset face recognition ran on
 *   F <asset id> <person id|\N> <w> <h> <x1> <y1> <x2> <y2> <[v1,...,v512]>   every visible face
 *
 * and posts them in batches to POST /api/admin/faces/seed: `begin`, the `assets`, the `faces`,
 * `finish`. Nothing is written to disk: the vectors go from Immich's database to the sealed store
 * through memory only. Prints the seed's report, which carries aggregates only.
 *
 * Environment: MIGALLERY_URL (default http://127.0.0.1:3000), MIGALLERY_ADMIN_KEY (an admin API key).
 * Run inside the MiGallery container: `... | docker exec -i -e MIGALLERY_ADMIN_KEY <container>
 * bun scripts/faces/seed-client.mjs`.
 */

const BASE = process.env.MIGALLERY_URL || 'http://127.0.0.1:3000';
const KEY = process.env.MIGALLERY_ADMIN_KEY || '';
const FACE_BATCH = 2000;
const ASSET_BATCH = 20000;

/** @param {{ phase: string } & Record<string, unknown>} body */
async function post(body) {
  const res = await fetch(`${BASE}/api/admin/faces/seed`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': KEY },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${body.phase}: HTTP ${res.status} ${text.slice(0, 300)}`);
  }
  return JSON.parse(text);
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
  const started = Date.now();
  await post({ phase: 'begin' });
  /** @type {string[]} */
  let assets = [];
  /** @type {ReturnType<typeof parseFaceLine>[]} */
  let faces = [];
  const totals = { assets: 0, faces: 0, linked: 0, unusable: 0 };
  const flushAssets = async () => {
    if (assets.length > 0) {
      await post({ phase: 'assets', ids: assets });
      totals.assets += assets.length;
      assets = [];
    }
  };
  const flushFaces = async () => {
    if (faces.length > 0) {
      const r = await post({ phase: 'faces', faces });
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
      if (cols[0] === 'A' && cols.length === 2) {
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
  await flushAssets();
  await flushFaces();
  console.error(`sent: ${JSON.stringify(totals)}; deciding every face...`);
  const { report } = await post({ phase: 'finish' });
  console.log(JSON.stringify({ seconds: Math.round((Date.now() - started) / 1000), ...report }));
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(`seed failed: ${e.message}`);
    process.exit(1);
  });
}
