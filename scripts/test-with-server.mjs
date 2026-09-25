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

const API_BASE_URL = 'http://localhost:3000';
const HEALTH_URL = `${API_BASE_URL}/api/health`;
/** How long the server has to answer /api/health before the run FAILS (it is never skipped). */
const READINESS_DEADLINE_MS = 60000;
const READINESS_POLL_MS = 250;

/** Where this run's database lives; created in main(), removed in finish(). */
let runDir = '';
/** @type {import('child_process').ChildProcess | null} */
let server = null;

/**
 * The only environment the server and the tests see, on top of the OS basics inherited from the
 * shell (PATH, TEMP, ...). Mirrors what CI needs: dev routes on (the suite logs in through
 * `/dev/login-as`), no Immich, a trusted host, and this run's own database.
 */
function testEnv(databasePath) {
  return {
    ...process.env,
    NODE_ENV: 'test',
    PORT: '3000',
    ORIGIN: API_BASE_URL,
    API_BASE_URL,
    ENABLE_DEV_ROUTES: 'true',
    AUTH_TRUSTED_HOST: 'true',
    IMMICH_BASE_URL: '',
    IMMICH_API_KEY: '',
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

/**
 * Kill the server. On Windows child.kill() does not terminate the bun process tree, which leaks
 * a zombie holding port 3000 and breaks the next run; taskkill /T tears down the whole tree.
 */
function killServer() {
  if (!server || server.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    server.kill();
  }
}

/** Stop the server and delete this run's database, then exit with `code`. */
function finish(code) {
  killServer();
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
 * Resolve once /api/health answers. Reject if the server process exits first (port taken,
 * crash on boot) or the deadline passes - a server that is not up is a failed run, never a
 * reason to test against whatever else might be listening.
 */
async function waitForServer() {
  const deadline = Date.now() + READINESS_DEADLINE_MS;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`test server exited with code ${server.exitCode} before answering`);
    }
    if (await portAnswers()) return;
    await new Promise((r) => setTimeout(r, READINESS_POLL_MS));
  }
  throw new Error(`test server did not answer ${HEALTH_URL} within ${READINESS_DEADLINE_MS} ms`);
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
  const env = testEnv(join(runDir, 'migallery.db'));
  console.log(`🗄️  Test database: ${env.DATABASE_PATH}`);

  console.log('🔨 Building SvelteKit...\n');
  const buildCode = await runBun(['run', 'build'], env);
  if (buildCode !== 0) {
    console.error(`\n❌ Build failed with code ${buildCode}\n`);
    finish(buildCode);
  }

  console.log('🚀 Starting the test server...\n');
  server = spawn(process.execPath, ['--no-env-file', './build/index.js'], {
    stdio: 'inherit',
    env,
  });
  await waitForServer();
  console.log(`✅ ${HEALTH_URL} answers\n🧪 Running the tests...\n`);

  // vitest is started directly rather than through `bun run test:unit`: that script spawns a
  // nested bun, which would load `.env` again.
  const testCode = await runBun(['--bun', 'vitest', 'run'], env);
  console.log('\n🛑 Stopping the server...');
  finish(testCode);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log(`\n⚠️  ${signal} received, stopping the server...`);
    finish(1);
  });
}

main().catch((error) => {
  console.error('\n💥 Error:', error.message);
  finish(1);
});
