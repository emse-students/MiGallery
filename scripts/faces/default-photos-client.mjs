#!/usr/bin/env bun
/**
 * The one-off run of the DEFAULT profile photo (src/lib/server/profile-photo-default.ts) over every
 * enrolled member. Reads on stdin, tab-separated, the face Immich FEATURED for each person (the
 * thumbnail its people page showed, which was each member's avatar before lot A6):
 *
 *   G <person id> <asset id> <x1> <y1> <x2> <y2> <image width> <image height>
 *
 * An EMPTY stdin is refused unless `--no-featured` says it is meant (a failed or wrong export
 * must not silently run without the featured faces; with the flag every member is ranked from
 * their own matches). Posts them to
 * POST /api/admin/faces/default-photos, and polls GET until the run is done; prints the report,
 * which carries counts only. `--dry-run` decides without writing anything.
 *
 * Environment: MIGALLERY_URL (default http://127.0.0.1:3000), MIGALLERY_ADMIN_KEY (an admin API key).
 * Run inside the MiGallery container: `... | docker exec -i -e MIGALLERY_ADMIN_KEY <container>
 * bun scripts/faces/default-photos-client.mjs [--dry-run] [--no-featured]` (the export command is in
 * docs/wiki/face-matching-option-c.md, "The default profile photo").
 */

const BASE = process.env.MIGALLERY_URL || 'http://127.0.0.1:3000';
const KEY = process.env.MIGALLERY_ADMIN_KEY || '';
/** Between two polls: a cadence, never a deadline. */
const POLL_MS = 3000;

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

/**
 * The featured faces of the export, one per line; a malformed line stops the run.
 * @param {string} text
 */
export function parseFeatured(text) {
  const out = [];
  for (const [n, line] of text.split('\n').entries()) {
    if (line.trim() === '') continue;
    const f = line.split('\t');
    const nums = f.slice(3, 9).map(Number);
    if (f[0] !== 'G' || f.length !== 9 || nums.some((v) => !Number.isFinite(v))) {
      throw new Error(`line ${n + 1}: expected "G person asset x1 y1 x2 y2 w h"`);
    }
    const [x1, y1, x2, y2, imgW, imgH] = nums;
    out.push({ person: f[1], assetId: f[2], x1, y1, x2, y2, imgW, imgH });
  }
  return out;
}

/**
 * An empty export is refused unless `--no-featured` says it is meant; featured faces WITH that flag
 * are refused too (the two say opposite things).
 * @param {number} count
 * @param {boolean} noFeatured
 */
export function checkFeaturedCount(count, noFeatured) {
  if (count === 0 && !noFeatured) {
    throw new Error(
      'no featured face on stdin: check the export, or pass --no-featured to run without'
    );
  }
  if (count > 0 && noFeatured) {
    throw new Error('--no-featured given, but stdin carries featured faces');
  }
}

async function main() {
  if (!KEY) throw new Error('MIGALLERY_ADMIN_KEY is not set');
  const dryRun = process.argv.includes('--dry-run');
  const featured = parseFeatured(await Bun.stdin.text());
  console.log(`featured faces read: ${featured.length}`);
  checkFeaturedCount(featured.length, process.argv.includes('--no-featured'));
  const headers = { 'content-type': 'application/json', 'x-api-key': KEY };
  await answer(
    await fetch(`${BASE}/api/admin/faces/default-photos`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ featured, dryRun }),
    }),
    'start'
  );
  for (;;) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    const state = await answer(
      await fetch(`${BASE}/api/admin/faces/default-photos`, { headers }),
      'poll'
    );
    if (state.status === 'running') continue;
    console.log(JSON.stringify(state, null, 2));
    if (state.status !== 'done') process.exit(1);
    return;
  }
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(`default photos failed: ${e.message}`);
    process.exit(1);
  });
}
