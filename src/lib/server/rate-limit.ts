/**
 * A per-key sliding-window limit, held in this process. It guards COST (a call to a service, a
 * scan), never correctness: a restart forgets it, which only gives a key a fresh window. Nothing
 * may depend on it for what the data says.
 */

/** What a limited request is told. */
export interface RateDecision {
  allowed: boolean;
  /** When refused: seconds until the oldest counted request leaves the window (at least 1). */
  retryAfterSeconds: number;
}

/** At most `limit` requests per key in any `windowMs`. */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    readonly limit: number,
    readonly windowMs: number
  ) {}

  /** Count one request for `key` if the window has room; refuse it (counting nothing) otherwise. */
  take(key: string, now: number = Date.now()): RateDecision {
    const since = now - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((t) => t > since);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((recent[0] - since) / 1000)),
      };
    }
    recent.push(now);
    this.hits.set(key, recent);
    this.prune(since);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  /** Drop the keys whose every request left the window, so the map stays the size of the active set. */
  private prune(since: number): void {
    for (const [key, times] of this.hits) {
      if (times[times.length - 1] <= since) {
        this.hits.delete(key);
      }
    }
  }

  /** Forget every key (for the tests). */
  reset(): void {
    this.hits.clear();
  }
}
