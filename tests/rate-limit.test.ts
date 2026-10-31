/**
 * The per-key sliding-window limit (src/lib/server/rate-limit.ts): what it counts, when a refused
 * key gets room again, and that keys never share a window. The clock is passed in, never read.
 */

import { describe, it, expect } from 'vitest';
import { RateLimiter } from '#lib/server/rate-limit.ts';

describe('RateLimiter', () => {
  it('allows `limit` requests in a window, refuses the next, and counts no refusal', () => {
    const limiter = new RateLimiter(2, 1000);
    expect(limiter.take('a', 0).allowed).toBe(true);
    expect(limiter.take('a', 100).allowed).toBe(true);
    expect(limiter.take('a', 200)).toEqual({ allowed: false, retryAfterSeconds: 1 });
    expect(limiter.take('a', 999).allowed).toBe(false);
    // The first request leaves the window at 1000: room for one, the refusals counted nothing.
    expect(limiter.take('a', 1000).allowed).toBe(true);
    expect(limiter.take('a', 1050).allowed).toBe(false);
    expect(limiter.take('a', 1100).allowed).toBe(true);
  });

  it('keeps every key in its own window', () => {
    const limiter = new RateLimiter(1, 60_000);
    expect(limiter.take('a', 0).allowed).toBe(true);
    expect(limiter.take('b', 0).allowed).toBe(true);
    expect(limiter.take('a', 1).allowed).toBe(false);
  });

  it('says how long until the oldest request leaves the window', () => {
    const limiter = new RateLimiter(1, 60_000);
    limiter.take('a', 0);
    expect(limiter.take('a', 30_000).retryAfterSeconds).toBe(30);
  });
});
