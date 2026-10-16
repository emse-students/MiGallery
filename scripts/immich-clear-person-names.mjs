/**
 * Admin procedure: remove every existing person NAME and BIRTH DATE in Immich (owner decision
 * 2026-10-16: Immich keeps anonymous clusters, but no cluster may carry a name).
 *
 * DRY RUN BY DEFAULT: it prints how many people carry a name or a birth date and changes nothing.
 * Names are never printed - they are the personal data being removed. Take a dump of the Immich
 * database first, then pass `--apply`.
 *
 *   IMMICH_BASE_URL=https://immich.example IMMICH_API_KEY=... bun scripts/immich-clear-person-names.mjs
 *   IMMICH_BASE_URL=... IMMICH_API_KEY=... bun scripts/immich-clear-person-names.mjs --apply
 *
 * The key needs the person.read and person.update permissions. Hidden people are included.
 * Re-running is safe: a cleared person is skipped. Documented in docs/wiki/photos-cv.md#erasure.
 */

const apply = process.argv.includes('--apply');
const base = (process.env.IMMICH_BASE_URL ?? '').replace(/\/$/, '');
const key = process.env.IMMICH_API_KEY ?? '';
if (!base || !key) {
  console.error('IMMICH_BASE_URL and IMMICH_API_KEY are required');
  process.exit(2);
}

const call = async (method, path, body) => {
  const init = {
    method,
    signal: AbortSignal.timeout(30_000),
    headers: { 'x-api-key': key, Accept: 'application/json' },
  };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`${base}/api/${path}`, init);
  if (!res.ok) {
    throw new Error(`${method} ${path}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  return res.json();
};

const named = [];
let total = 0;
for (let page = 1; ; page++) {
  const body = await call('GET', `people?withHidden=true&page=${page}&size=1000`);
  total += body.people.length;
  for (const p of body.people) {
    if (p.name || p.birthDate) {
      named.push(p.id);
    }
  }
  if (body.hasNextPage !== true) {
    break;
  }
}
console.log(`${total} people in Immich, ${named.length} carry a name or a birth date`);

if (!apply) {
  console.log('dry run: nothing written. Re-run with --apply after a database dump.');
  process.exit(0);
}

let cleared = 0;
const failed = [];
for (const id of named) {
  try {
    await call('PUT', `people/${encodeURIComponent(id)}`, { name: '', birthDate: null });
    const after = await call('GET', `people/${encodeURIComponent(id)}`);
    if (after.name || after.birthDate) {
      throw new Error('still named after the write');
    }
    cleared++;
  } catch (e) {
    failed.push(id);
    console.error(`person ${id}: ${e.message}`);
  }
}
console.log(`cleared ${cleared}, failed ${failed.length}`);
process.exit(failed.length === 0 ? 0 : 1);
