#!/usr/bin/env bun
/**
 * Build the app, start it on a DISPOSABLE database, run the whole vitest suite against it, and
 * delete that database. Usage: `bun run test`.
 *
 * The suite is hermetic by construction: it never reads the developer's `.env`, whatever it says.
 *
 * - Every child is started as `bun --no-env-file` with an environment this script writes itself,
 *   so neither the server nor vitest can pick up `DATABASE_PATH`, `IMMICH_BASE_URL` or anything
 *   else from a `.env` in the working tree. (`package.json` starts THIS script with
 *   `--no-env-file` too, so nothing leaks through our own `process.env` either.)
 * - `DATABASE_PATH` is a fresh file in a per-run temp directory. The server creates its schema
 *   on first open, and the directory is removed when the run ends.
 * - `IMMICH_BASE_URL` is empty: the suite's contract is "no Immich", the same as CI. A developer
 *   `.env` pointing at a tunnel to the production Immich used to make the suite create real
 *   `[TEST]` albums there AND fail tests whose assertions only run when Immich answers.
 *
 * Why it had to be this way: the dev `.env` points `DATABASE_PATH` at a shared dev database, and
 * every run left an admin `test.user.<timestamp>`, an API key and album rows in it. The server no
 * longer lets a `.env` override the environment it is started with (the `dotenv` override in
 * `hooks.server.ts` is gone), so the values below are the ones it actually runs on.
 */

import { spawn, spawnSync } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Database } from 'bun:sqlite';
import { TEST_CONFIG } from '../tests/test-helpers.ts';

/**
 * The port the suite's own server listens on. 3000 by default (CI); `MIGALLERY_TEST_PORT` moves it
 * when a workstation already runs something there - the refusal below still guards whatever port
 * is chosen.
 */
const TEST_PORT = process.env.MIGALLERY_TEST_PORT || '3000';
const API_BASE_URL = `http://localhost:${TEST_PORT}`;
const HEALTH_URL = `${API_BASE_URL}/api/health`;
/** How long the server has to answer /api/health before the run FAILS (it is never skipped). */
const READINESS_DEADLINE_MS = 60000;
const READINESS_POLL_MS = 250;

/**
 * Write the suite's admin row into this run's database. `/dev/login-as` only opens a session for a
 * user that already exists. The runner owns this disposable database, so it writes the row once,
 * after /api/health has made the server create the schema; no test writes it.
 */
function seedTestAdmin(databasePath) {
  const db = new Database(databasePath);
  try {
    db.prepare(
      'INSERT OR IGNORE INTO users (id_user, name, first_name, last_name, role) VALUES (?, ?, ?, ?, ?)'
    ).run(TEST_CONFIG.TEST_ADMIN_ID, 'Test Admin', 'Test', 'Admin', 'admin');
  } finally {
    db.close(false);
  }
  console.log(`👤 Test admin ${TEST_CONFIG.TEST_ADMIN_ID} written`);
}

/** Where this run's database lives; created in main(), removed in finish(). */
let runDir = '';
/** @type {import('child_process').ChildProcess | null} */
let server = null;

/**
 * The only environment the server and the tests see, on top of the OS basics inherited from the
 * shell (PATH, TEMP, ...). Mirrors what CI needs: no Immich, a trusted host, and this run's own
 * database. The dev login the suite signs in through (`/dev/login-as`) is not switched on here: it
 * exists only in the `--mode test` build made below, never in a production build.
 */
function testEnv(databasePath, issuer) {
  return {
    ...process.env,
    NODE_ENV: 'test',
    PORT: TEST_PORT,
    API_BASE_URL,
    AUTH_TRUSTED_HOST: 'true',
    IMMICH_BASE_URL: '',
    IMMICH_API_KEY: '',
    // This run's fake provider (startFakeProvider): tests/server-env.test.ts reads them back
    // through the BUILT server.
    MICONNECT_ISSUER: issuer,
    MICONNECT_CLIENT_ID: 'test-client-id',
    MICONNECT_CLIENT_SECRET: 'test-client-secret',
    AVATAR_SIGNING_KEY: 'test-avatar-signing-key',
    DATABASE_PATH: databasePath,
    // Read by tests/test-helpers.ts `openTestDatabase`, which refuses to open anything else.
    MIGALLERY_TEST_DATABASE: databasePath,
  };
}

/**
 * Run a bun child to completion with `.env` loading disabled, and resolve with its exit code.
 */
function runBun(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--no-env-file', ...args], { stdio: 'inherit', env });
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 1));
  });
}

/** How long the server has to leave after a SIGTERM before the run calls that a failure. */
const GRACEFUL_STOP_DEADLINE_MS = 15000;

/**
 * Stop the server the way `docker stop` does: a real SIGTERM, then wait for it to leave. Resolves
 * with the exit code, or `'timeout'` when it had to be SIGKILLed - adapter-bun drains and emits
 * `sveltekit:shutdown` but never exits by itself, so a server with no listener hangs here, which
 * is exactly what `docker stop` turns into a 137 after its grace period (src/lib/server/shutdown.ts).
 *
 * On Windows a signal cannot reach a JS handler (child.kill() terminates abruptly and leaks the
 * process tree holding the port), so there the tree is torn down with taskkill /T and nothing is
 * asserted: the graceful path is proven on Linux, which is where it ships.
 * @returns {Promise<number | 'timeout' | null>} null when there was nothing to stop or no assertion is possible
 */
async function stopServer() {
  if (!server || server.exitCode !== null) return server ? server.exitCode : null;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
    return null;
  }
  const exited = new Promise((resolve) => server.once('exit', (code) => resolve(code ?? 1)));
  server.kill('SIGTERM');
  let deadline;
  const timedOut = new Promise((resolve) => {
    deadline = setTimeout(() => resolve('timeout'), GRACEFUL_STOP_DEADLINE_MS);
  });
  const result = await Promise.race([exited, timedOut]);
  clearTimeout(deadline);
  if (result === 'timeout') server.kill('SIGKILL');
  return result;
}

/** Stop the server, delete this run's database, then exit with `code` (1 if the stop was not clean). */
async function finish(code) {
  const stopped = await stopServer();
  if (stopped === 'timeout' || (typeof stopped === 'number' && stopped !== 0)) {
    const how =
      stopped === 'timeout'
        ? `still running after ${GRACEFUL_STOP_DEADLINE_MS} ms`
        : `exit code ${stopped}`;
    console.error(`
❌ The server did not stop cleanly on SIGTERM (${how}); expected exit code 0.
`);
    code = code || 1;
  } else if (stopped === 0) {
    console.log('✅ The server exited 0 on SIGTERM');
  }
  if (runDir) {
    try {
      rmSync(runDir, { recursive: true, force: true });
      console.log(`🧹 Test database removed (${runDir})`);
    } catch (e) {
      // The run's result stands; a directory the OS still holds is left to TEMP, and said so.
      console.warn(`⚠️  Could not remove ${runDir}: ${e.message}`);
    }
  }
  process.exit(code);
}

/** True when something already answers on the test port. */
async function portAnswers() {
  try {
    await fetch(HEALTH_URL);
    return true;
  } catch {
    return false;
  }
}

/**
 * True when THIS run's database file already holds the schema. It opens read-only so it can never
 * create the file: `new Database(path)` on a missing path makes an empty one, which is exactly
 * how a seed against a database nobody initialised fails with `no such table: users`.
 */
function schemaReady(databasePath) {
  let db;
  try {
    db = new Database(databasePath, { readonly: true });
    db.prepare('SELECT 1 FROM users LIMIT 1').get();
    return true;
  } catch {
    return false;
  } finally {
    db?.close(false);
  }
}

/**
 * Describe what /api/health answered, or why it did not, in one line.
 * @returns {Promise<{ready: boolean, line: string}>}
 */
async function probeHealth() {
  try {
    const res = await fetch(HEALTH_URL);
    const body = (await res.text()).slice(0, 200);
    return { ready: res.status === 200, line: `HTTP ${res.status} ${body}` };
  } catch (e) {
    return { ready: false, line: `no answer (${e.message})` };
  }
}

/**
 * Resolve once the server is READY for what the runner does next: /api/health answers 200 AND this
 * run's own database holds the schema (the seed writes into it). Any HTTP answer used to count,
 * so a 503, or a listener that is not our server at all, let the seed run on an empty database.
 * The database check is the proof the answer came from the server we started: it is the only one
 * that creates this file's schema. Each distinct non-ready state is logged once - that line is the
 * evidence if a run ever fails here. Reject if the server process exits first (port taken, crash
 * on boot) or the deadline passes - a server that is not up is a failed run, never a reason to
 * test against whatever else might be listening.
 */
async function waitForServer(databasePath) {
  const deadline = Date.now() + READINESS_DEADLINE_MS;
  let lastLogged = '';
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`test server exited with code ${server.exitCode} before answering`);
    }
    const health = await probeHealth();
    if (health.ready && schemaReady(databasePath)) return;
    const line = health.ready
      ? `health answered 200 but this run's database has no schema yet`
      : health.line;
    if (!health.line.startsWith('no answer') && line !== lastLogged) {
      console.warn(`⏳ Not ready: ${line}`);
      lastLogged = line;
    }
    await new Promise((r) => setTimeout(r, READINESS_POLL_MS));
  }
  throw new Error(
    `test server did not become ready on ${HEALTH_URL} within ${READINESS_DEADLINE_MS} ms`
  );
}

/**
 * A fake identity provider on a free local port. Its token endpoint REFUSES every code (400
 * `invalid_grant`), which is what a real provider answers to a forged or replayed code - the case
 * the suite exercises. Before it, the issuer was an unresolvable `.invalid` host: every callback
 * test reached a DNS failure, which the server rightly logs as an ERROR (a provider it cannot
 * reach), so the suite printed a server fault on every run for a case that is the client's.
 * @returns {{ issuer: string, stop: () => void }}
 */
function startFakeProvider() {
  const provider = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      if (new URL(request.url).pathname === '/application/o/token/') {
        return Response.json({ error: 'invalid_grant' }, { status: 400 });
      }
      return new Response('not found', { status: 404 });
    },
  });
  return {
    issuer: `http://127.0.0.1:${provider.port}/application/o/migallery`,
    stop: () => provider.stop(true),
  };
}

async function main() {
  if (await portAnswers()) {
    console.error(
      `\n⛔ Something already answers on ${API_BASE_URL}. The suite would test THAT server and ` +
        `its database, not this build. Stop it and re-run.\n`
    );
    process.exit(1);
  }

  runDir = mkdtempSync(join(tmpdir(), 'migallery-test-'));
  const provider = startFakeProvider();
  process.on('exit', provider.stop);
  const env = testEnv(join(runDir, 'migallery.db'), provider.issuer);
  console.log(`🗄️  Test database: ${env.DATABASE_PATH}`);

  // `--mode test` is what compiles `/dev/login-as` into this build (its handler is folded out of
  // every other build); see src/routes/dev/login-as/+server.ts.
  console.log('🔨 Building SvelteKit (mode test)...\n');
  const buildCode = await runBun(['run', 'build', '--mode', 'test'], env);
  if (buildCode !== 0) {
    console.error(`\n❌ Build failed with code ${buildCode}\n`);
    await finish(buildCode);
  }

  console.log('🚀 Starting the test server...\n');
  server = spawn(process.execPath, ['--no-env-file', './build/index.js'], {
    stdio: 'inherit',
    env,
  });
  await waitForServer(env.DATABASE_PATH);
  seedTestAdmin(env.DATABASE_PATH);
  console.log(`✅ ${HEALTH_URL} answers\n🧪 Running the tests...\n`);

  // vitest is started directly rather than through `bun run test:unit`: that script spawns a
  // nested bun, which would load `.env` again.
  const testCode = await runBun(['--bun', 'vitest', 'run'], env);
  console.log('\n🛑 Stopping the server...');
  await finish(testCode);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    console.log(`\n⚠️  ${signal} received, stopping the server...`);
    await finish(1);
  });
}

main().catch(async (error) => {
  console.error('\n💥 Error:', error.message);
  await finish(1);
});
