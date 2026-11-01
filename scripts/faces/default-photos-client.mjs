#!/usr/bin/env bun
/**
 * The one-off run of the DEFAULT profile photo (src/lib/server/profile-photo-default.ts) over every
 * enrolled member. Reads on stdin, tab-separated, Immich's own table (one export, one snapshot):
 *
 *   G <person id> <asset id> <x1> <y1> <x2> <y2> <image width> <image height>
 *       the face Immich FEATURED for each person (its people page's thumbnail, each member's
 *       avatar before lot A6). The export may carry EVERY person (about 94k in production): the
 *       client asks the server which persons it can use (GET ?wanted=1, the members' linked
 *       ids) and posts only those, so no hand filtering is needed;
 *   P <asset id>
 *       every asset Immich still holds (not deleted, not in the trash), LOCKED INCLUDED: the only
 *       evidence that a member's CHOSEN photo is gone, since the API answers the same 400 for a
 *       deleted asset and a locked one. A chosen photo absent from the P lines is replaced; one
 *       present (locked or not) is kept.
 *
 * An export with no G line or no P line is refused unless `--no-featured` says an empty stdin is
 * meant (a failed or wrong export must not silently run without them; with the flag every member
 * is ranked from their own matches, and a choice goes only when its photo is in the trash). Posts
 * them to
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
 * The export: the featured faces (G lines) and the asset ids Immich still holds (P lines). A
 * malformed line stops the run.
 * @param {string} text
 */
export function parseExport(text) {
  const featured = [];
  const present = [];
  for (const [n, line] of text.split('\n').entries()) {
    if (line.trim() === '') continue;
    const f = line.split('\t');
    if (f[0] === 'P' && f.length === 2 && f[1] !== '') {
      present.push(f[1]);
      continue;
    }
    const nums = f.slice(3, 9).map(Number);
    if (f[0] !== 'G' || f.length !== 9 || nums.some((v) => !Number.isFinite(v))) {
      throw new Error(`line ${n + 1}: expected "G person asset x1 y1 x2 y2 w h" or "P asset"`);
    }
    const [x1, y1, x2, y2, imgW, imgH] = nums;
    featured.push({ person: f[1], assetId: f[2], x1, y1, x2, y2, imgW, imgH });
  }
  return { featured, present };
}

/**
 * An export without featured faces or without present assets is refused unless `--no-featured`
 * says an empty stdin is meant; anything on stdin WITH that flag is refused too (the two say
 * opposite things).
 * @param {{ featured: unknown[], present: unknown[] }} parsed
 * @param {boolean} noFeatured
 */
export function checkExport({ featured, present }, noFeatured) {
  if (noFeatured) {
    if (featured.length > 0 || present.length > 0) {
      throw new Error('--no-featured given, but stdin carries an export');
    }
    return;
  }
  if (featured.length === 0) {
    throw new Error('no featured face (G) on stdin: check the export, or pass --no-featured');
  }
  if (present.length === 0) {
    throw new Error('no present asset (P) on stdin: the export is incomplete, check it');
  }
}

/**
 * The G lines the server can use: those whose person is in `wanted`, compared case-insensitively
 * (the server keeps `photos_id` lowercase, Immich's export may not). One entry per person.
 * @param {Array<{ person: string }>} featured
 * @param {Iterable<string>} wanted
 */
export function keepWanted(featured, wanted) {
  const set = new Set([...wanted].map((id) => id.toLowerCase()));
  const byPerson = new Map();
  for (const f of featured) {
    const person = f.person.toLowerCase();
    if (set.has(person)) byPerson.set(person, f);
  }
  return [...byPerson.values()];
}

/**
 * The person ids the server wants, from its answer to `GET ?wanted=1`. A server without the
 * feature answers the run state instead: say so, never an opaque TypeError later.
 * @param {unknown} body
 * @returns {string[]}
 */
export function readWanted(body) {
  const people = /** @type {{ people?: unknown } | null} */ (body)?.people;
  if (!Array.isArray(people)) {
    throw new Error(
      'the server does not support ?wanted=1: deploy a MiGallery build carrying it first (the one that ships this client)'
    );
  }
  return people;
}

async function main() {
  if (!KEY) throw new Error('MIGALLERY_ADMIN_KEY is not set');
  const dryRun = process.argv.includes('--dry-run');
  const parsed = parseExport(await Bun.stdin.text());
  const { featured, present } = parsed;
  console.log(`featured faces read: ${featured.length}; present assets read: ${present.length}`);
  checkExport(parsed, process.argv.includes('--no-featured'));
  const headers = { 'content-type': 'application/json', 'x-api-key': KEY };
  const people = readWanted(
    await answer(
      await fetch(`${BASE}/api/admin/faces/default-photos?wanted=1`, { headers }),
      'wanted'
    )
  );
  const sent = keepWanted(featured, people);
  console.log(`linked members wanting a featured face: ${people.length}; sent: ${sent.length}`);
  await answer(
    await fetch(`${BASE}/api/admin/faces/default-photos`, {
      method: 'POST',
      headers,
      body: JSON.stringify(
        present.length > 0 ? { featured: sent, present, dryRun } : { featured: sent, dryRun }
      ),
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
