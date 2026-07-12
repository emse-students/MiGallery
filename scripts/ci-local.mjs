#!/usr/bin/env node
/**
 * Local mirror of .github/workflows/ci.yml.
 *
 * Runs the same gates CI runs (type-check, lint, build, fresh-DB integration
 * tests) so failures surface here instead of in CD after a push. Wired to the
 * pre-push hook (.husky/pre-push) via `npm run validate`.
 *
 * Why the .env dance: the built server force-loads the repo-root .env
 * (hooks.server.ts calls dotenv config({ override: true })), and the dev .env
 * points IMMICH_BASE_URL at prod. So the only way to run the suite like CI -
 * against an empty Immich, with dev routes enabled, on a disposable DB - is to
 * briefly stand in a synthetic .env. This script is side-effect-free: it
 * snapshots and restores the real .env and data/migallery.db* even on crash or
 * Ctrl-C, and self-heals from a previously interrupted run.
 */

import { spawnSync } from 'child_process';
import { existsSync, copyFileSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';

const root = process.cwd();
const envPath = join(root, '.env');
const bak = (p) => p + '.civalidate-bak';
const dbFiles = ['data/migallery.db', 'data/migallery.db-wal', 'data/migallery.db-shm'].map((f) =>
	join(root, f)
);

// Mirrors the .env ci.yml writes for its test job (empty Immich, dev routes on).
const SYNTH_ENV = [
	'ENABLE_DEV_ROUTES=true',
	'COOKIE_SECRET=ci-local-secret-not-for-production-use',
	'DATABASE_PATH=./data/migallery.db',
	'IMMICH_BASE_URL=',
	'IMMICH_API_KEY=',
	'AUTH_TRUSTED_HOST=true',
	''
].join('\n');

let snapshotted = false;

function restore() {
	for (const p of [envPath, ...dbFiles]) {
		if (existsSync(bak(p))) {
			copyFileSync(bak(p), p);
			rmSync(bak(p), { force: true });
		}
	}
}

function snapshot() {
	for (const p of [envPath, ...dbFiles]) {
		if (existsSync(p)) copyFileSync(p, bak(p));
	}
	snapshotted = true;
}

function fail(label, code) {
	if (snapshotted) restore();
	console.error(`\n\x1b[31m❌ ${label} failed (exit ${code})\x1b[0m`);
	process.exit(typeof code === 'number' && code ? code : 1);
}

// Best-effort: free port 3000 in case a previous run was interrupted mid-test
// and left a server behind (test-with-server tree-kills on a clean exit, but
// not on Ctrl-C). Keeps the pre-push hook from failing on a stale zombie.
function freePort(port) {
	try {
		if (process.platform === 'win32') {
			const out = spawnSync('netstat', ['-ano'], { encoding: 'utf8' }).stdout || '';
			const pids = new Set();
			for (const line of out.split('\n')) {
				if (line.includes(`:${port} `) && /LISTENING/i.test(line)) {
					const pid = line.trim().split(/\s+/).pop();
					if (/^\d+$/.test(pid)) pids.add(pid);
				}
			}
			for (const pid of pids) spawnSync('taskkill', ['/pid', pid, '/T', '/F'], { stdio: 'ignore' });
		} else {
			spawnSync('sh', ['-c', `fuser -k ${port}/tcp 2>/dev/null || true`], { stdio: 'ignore' });
		}
	} catch {
		/* best effort */
	}
}

function run(label, cmd, args, extraEnv = {}) {
	console.log(`\n\x1b[36m=== ${label} ===\x1b[0m`);
	const res = spawnSync(cmd, args, {
		stdio: 'inherit',
		shell: process.platform === 'win32',
		env: { ...process.env, ...extraEnv }
	});
	if (res.status !== 0) fail(label, res.status ?? res.signal);
}

// Self-heal: a leftover backup means a previous run was interrupted mid-swap;
// it holds the real files, so restore before touching anything.
if ([envPath, ...dbFiles].some((p) => existsSync(bak(p)))) {
	console.warn('\x1b[33m⚠️  Recovering files from a previously interrupted validate run.\x1b[0m');
	restore();
}

if (!existsSync(envPath)) {
	console.error('❌ No .env at repo root; cannot run the local CI mirror.');
	process.exit(1);
}

for (const sig of ['SIGINT', 'SIGTERM']) {
	process.on(sig, () => {
		if (snapshotted) restore();
		process.exit(1);
	});
}

try {
	// Static gates first, while the real .env is still in place.
	run('Type check', 'npm', ['run', 'check']);
	run('Lint', 'npm', ['run', 'lint'], { NODE_OPTIONS: '--max-old-space-size=16384' });

	// Stand in the synthetic env for the server-backed steps.
	snapshot();
	writeFileSync(envPath, SYNTH_ENV);

	// Fresh DB (ci.yml "Setup test database"), then build + integration tests.
	// test-with-server.mjs builds the server itself, so a build break fails here
	// too, covering ci.yml's standalone "Build" step.
	run('DB init', 'npm', ['run', 'db:init'], { DATABASE_PATH: './data/migallery.db' });
	freePort(3000);
	run('Build + tests', 'npm', ['run', 'test'], { API_BASE_URL: 'http://localhost:3000' });

	console.log('\n\x1b[32m✅ Local CI passed - safe to push.\x1b[0m');
} finally {
	if (snapshotted) restore();
}
