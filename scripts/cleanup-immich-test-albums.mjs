#!/usr/bin/env node
/**
 * Delete leftover "[TEST] ..." albums that the integration suite creates in
 * Immich but does not always tear down (interrupted runs, untracked ids, or a
 * `npm run test` accidentally pointed at a real Immich). They show up as empty
 * "[TEST] Album" / "[TEST] Permission Album <timestamp>" albums.
 *
 * Safe by default:
 *   - DRY RUN unless --apply is passed (prints what it would delete).
 *   - Only matches albums whose name starts with the prefix (default "[TEST] ").
 *   - Only deletes EMPTY albums (assetCount === 0) unless --include-nonempty.
 *
 * Usage:
 *   node scripts/cleanup-immich-test-albums.mjs                 # dry run
 *   node scripts/cleanup-immich-test-albums.mjs --apply         # delete empty [TEST] albums
 *   node scripts/cleanup-immich-test-albums.mjs --apply --include-nonempty
 *   node scripts/cleanup-immich-test-albums.mjs --prefix "[TEST] " --apply
 *
 * Env: IMMICH_BASE_URL and IMMICH_API_KEY (read from process.env, falling back
 * to a local .env file if present).
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Minimal .env loader so the script is runnable locally without extra deps.
function loadDotEnv() {
	const envPath = join(__dirname, '..', '.env');
	if (!existsSync(envPath)) return;
	for (const line of readFileSync(envPath, 'utf8').split('\n')) {
		const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
		if (!m) continue;
		const key = m[1];
		if (process.env[key] !== undefined) continue;
		let val = m[2].trim();
		if (
			(val.startsWith('"') && val.endsWith('"')) ||
			(val.startsWith("'") && val.endsWith("'"))
		) {
			val = val.slice(1, -1);
		}
		process.env[key] = val;
	}
}

function parseArgs(argv) {
	const args = { apply: false, includeNonEmpty: false, prefix: '[TEST] ' };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--apply') args.apply = true;
		else if (a === '--include-nonempty') args.includeNonEmpty = true;
		else if (a === '--prefix') args.prefix = argv[++i] ?? args.prefix;
	}
	return args;
}

async function main() {
	loadDotEnv();
	const args = parseArgs(process.argv.slice(2));

	const baseUrl = (process.env.IMMICH_BASE_URL || '').replace(/\/$/, '');
	const apiKey = process.env.IMMICH_API_KEY || '';
	if (!baseUrl || !apiKey) {
		console.error('ERROR: IMMICH_BASE_URL and IMMICH_API_KEY must be set (env or .env).');
		process.exit(1);
	}

	const headers = { 'x-api-key': apiKey, Accept: 'application/json' };

	const res = await fetch(`${baseUrl}/api/albums`, { headers });
	if (!res.ok) {
		console.error(`ERROR: failed to list albums: ${res.status} ${res.statusText}`);
		process.exit(1);
	}
	const albums = await res.json();
	if (!Array.isArray(albums)) {
		console.error('ERROR: unexpected /api/albums response (not an array).');
		process.exit(1);
	}

	const matched = albums.filter((a) => typeof a?.albumName === 'string' && a.albumName.startsWith(args.prefix));
	const targets = args.includeNonEmpty ? matched : matched.filter((a) => (a.assetCount ?? 0) === 0);

	console.log(`Total albums: ${albums.length}`);
	console.log(`Matching prefix "${args.prefix}": ${matched.length}`);
	console.log(
		`Targets to delete (${args.includeNonEmpty ? 'all matched' : 'empty only'}): ${targets.length}`
	);
	for (const a of targets) {
		console.log(`  - ${a.id}  [${a.assetCount ?? 0} assets]  ${a.albumName}`);
	}

	if (targets.length === 0) {
		console.log('Nothing to delete.');
		return;
	}

	if (!args.apply) {
		console.log('\nDRY RUN. Re-run with --apply to delete the albums above.');
		return;
	}

	let ok = 0;
	let failed = 0;
	for (const a of targets) {
		const del = await fetch(`${baseUrl}/api/albums/${a.id}`, { method: 'DELETE', headers });
		if (del.ok || del.status === 204) {
			ok++;
		} else {
			failed++;
			console.warn(`  ! failed to delete ${a.id}: ${del.status} ${del.statusText}`);
		}
	}
	console.log(`\nDeleted ${ok} album(s), ${failed} failure(s).`);
	if (failed > 0) process.exit(1);
}

main().catch((e) => {
	console.error('ERROR:', e?.message || e);
	process.exit(1);
});
