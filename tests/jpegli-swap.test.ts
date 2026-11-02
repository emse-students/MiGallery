/**
 * Runs the Python unit tests of the host-side JPEGLI swap script: a run with zero swaps (or a dry
 * run) must make no call to Immich, a swap must queue the integrity refresh once, and a failed call
 * must be logged at ERROR. See docs/wiki/jpegli-recompression.md. The script imports `fcntl`, so it
 * only loads on Linux (CI and the host); there is no Windows equivalent to run.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';

describe.skipIf(process.platform === 'win32')('jpegli_swap integrity refresh', () => {
  it('passes its unittest suite', () => {
    const r = spawnSync('python3', ['scripts/server/test_jpegli_swap.py', '-v'], {
      encoding: 'utf8',
    });
    expect(r.error, String(r.error)).toBeUndefined();
    expect(r.stderr, r.stderr).toContain('OK');
    expect(r.status).toBe(0);
  });
});
