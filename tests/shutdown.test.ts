/**
 * The shutdown registry: every stopper runs, one failing never skips the rest, and the exit code
 * says whether all of them stopped. The SIGTERM-to-exit-0 path itself is proven on Linux by
 * `scripts/test-with-server.mjs`, which signals the built server for real.
 */
import { describe, it, expect } from 'vitest';
import { registerShutdown, runShutdown } from '#lib/server/shutdown.ts';

describe('runShutdown', () => {
  it('runs every stopper in order, awaits async ones, and exits 0', async () => {
    const order: string[] = [];
    registerShutdown('sync', () => {
      order.push('sync');
    });
    registerShutdown('async', async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push('async');
    });

    expect(await runShutdown('SIGTERM')).toBe(0);
    expect(order).toEqual(['sync', 'async']);
  });

  it('keeps going after a stopper throws, and exits 1', async () => {
    let ranAfter = false;
    registerShutdown('broken', () => {
      throw new Error('boom');
    });
    registerShutdown('after', () => {
      ranAfter = true;
    });

    expect(await runShutdown('SIGTERM')).toBe(1);
    expect(ranAfter).toBe(true);
  });
});
