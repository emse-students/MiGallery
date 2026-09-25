#!/usr/bin/env bun
/**
 * Local mirror of .github/workflows/ci.yml.
 *
 * Runs the same gates CI runs (type-check, lint, build, integration tests on a disposable
 * database) so failures surface here instead of in CD after a push. Wired to the pre-push hook
 * (.husky/pre-push) via `bun run validate`.
 *
 * It touches no file: `bun run test` never reads `.env` and runs on its own temp database with
 * no Immich (scripts/test-with-server.mjs), so there is nothing to swap in and restore.
 */

import { spawnSync } from 'child_process';

function run(label, cmd, args, extraEnv = {}) {
  console.log(`\n\x1b[36m=== ${label} ===\x1b[0m`);
  const res = spawnSync(cmd, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...extraEnv },
  });
  if (res.status !== 0) {
    const code = res.status ?? res.signal;
    console.error(`\n\x1b[31m❌ ${label} failed (exit ${code})\x1b[0m`);
    process.exit(typeof code === 'number' && code ? code : 1);
  }
}

run('Type check', 'bun', ['run', 'check']);
run('Lint', 'bun', ['run', 'lint'], { NODE_OPTIONS: '--max-old-space-size=16384' });
// test-with-server.mjs builds the server itself, so a build break fails here too, covering
// ci.yml's standalone "Build" step.
run('Build + tests', 'bun', ['run', 'test']);

console.log('\n\x1b[32m✅ Local CI passed - safe to push.\x1b[0m');
