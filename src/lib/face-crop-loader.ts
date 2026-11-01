/**
 * Loads the confirmation screen's face pictures (`/api/users/me/face/crops/...`) at a pace the
 * server can serve (faces v2, 2026-11-01).
 *
 * WHY A THIRD OF THE TILES WERE EMPTY. Every tile was a plain `<img loading="lazy">`: the browser
 * asked for every tile near the viewport AT ONCE (dozens on a desktop grid, more on each scroll).
 * A crop not yet cached is cut on the server under the ONE Sharp pool every image endpoint shares
 * (`sharp-limit.ts`: 4 running, 12 waiting); the 17th request at once is refused at once, 503
 * `busy` with `Retry-After: 2`. The `<img>` saw an error, the tile dropped its picture and kept
 * its grey skeleton forever: no retry, no state. On a screen of 165 suggestions that was a large
 * share of the tiles, never the same ones twice.
 *
 * THE FIX IS THE PACE, NOT A RETRY LOOP. At most {@link CROP_CONCURRENCY} crops are asked at a
 * time, below the pool's 4 slots, so this screen alone never fills the pool; tiles ask in the
 * order they come near the viewport, and the list is nearest first, so the top fills first. A
 * `busy` can still come from OTHER pages sharing the pool (album covers); that answer names its
 * own wait (`Retry-After`), which is honoured at most {@link BUSY_RETRIES} times and logged. Any
 * other failure is final for the attempt: the tile shows it and offers a retry button.
 */

/** Crops asked at once by one screen: under the server's 4 Sharp slots. */
export const CROP_CONCURRENCY = 3;
/** How many `busy` answers one crop waits out (each for the server's own `Retry-After`). */
export const BUSY_RETRIES = 2;
/** The wait when a `busy` answer names none (the server sends 2 s). */
const DEFAULT_RETRY_AFTER_MS = 2000;

/** A crop that did not load: `status` is the HTTP status, 0 when nothing answered. */
export class CropLoadError extends Error {
  constructor(readonly status: number) {
    super(`face crop not loaded (${status})`);
    this.name = 'CropLoadError';
  }
}

/** What the loader needs from its surroundings (the tests pass fakes). */
export interface CropLoaderDeps {
  fetchFn: (url: string, init?: RequestInit) => Promise<Response>;
  wait: (ms: number) => Promise<void>;
  concurrency?: number;
  busyRetries?: number;
  warn?: (message: string, detail?: unknown) => void;
}

/**
 * A queue of crop requests with at most `concurrency` in flight. `load` resolves with the
 * picture, or rejects with a {@link CropLoadError}; a request whose `signal` aborts before its turn
 * (its tile left the list) is dropped without asking the server.
 */
export class CropLoader {
  private inFlight = 0;
  private readonly waiting: Array<() => void> = [];
  private readonly concurrency: number;
  private readonly busyRetries: number;

  constructor(private readonly deps: CropLoaderDeps) {
    this.concurrency = deps.concurrency ?? CROP_CONCURRENCY;
    this.busyRetries = deps.busyRetries ?? BUSY_RETRIES;
  }

  /** How many requests are being served now (for the tests). */
  get active(): number {
    return this.inFlight;
  }

  async load(url: string, signal?: AbortSignal): Promise<Blob> {
    await this.turn(signal);
    try {
      for (let attempt = 0; ; attempt++) {
        let res: Response;
        try {
          res = await this.deps.fetchFn(url, { signal });
        } catch (e) {
          if (signal?.aborted) {
            throw e;
          }
          throw new CropLoadError(0);
        }
        if (res.ok) {
          return await res.blob();
        }
        if (res.status === 503 && attempt < this.busyRetries) {
          const wait = retryAfterMs(res.headers.get('Retry-After'));
          this.deps.warn?.('[face-crop] the server is busy; waiting as it asks', { wait });
          await res.body?.cancel().catch(() => undefined);
          await this.deps.wait(wait);
          if (signal?.aborted) {
            throw new DOMException('aborted', 'AbortError');
          }
          continue;
        }
        await res.body?.cancel().catch(() => undefined);
        throw new CropLoadError(res.status);
      }
    } finally {
      this.release();
    }
  }

  private turn(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      return Promise.reject(new DOMException('aborted', 'AbortError'));
    }
    if (this.inFlight < this.concurrency) {
      this.inFlight++;
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const go = () => {
        signal?.removeEventListener('abort', abort);
        this.inFlight++;
        resolve();
      };
      const abort = () => {
        const i = this.waiting.indexOf(go);
        if (i >= 0) {
          this.waiting.splice(i, 1);
        }
        reject(new DOMException('aborted', 'AbortError'));
      };
      signal?.addEventListener('abort', abort, { once: true });
      this.waiting.push(go);
    });
  }

  private release(): void {
    this.inFlight--;
    this.waiting.shift()?.();
  }
}

/** A `Retry-After` header in seconds (the only form the server sends), as milliseconds. */
export function retryAfterMs(header: string | null): number {
  if (header === null || header.trim() === '') {
    return DEFAULT_RETRY_AFTER_MS;
  }
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : DEFAULT_RETRY_AFTER_MS;
}

let shared: CropLoader | null = null;

/** The page's one loader, so every tile shares the same pace. */
export function sharedCropLoader(): CropLoader {
  shared ??= new CropLoader({
    fetchFn: (input, init) => fetch(input, init),
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    warn: (message, detail) => console.warn(message, detail),
  });
  return shared;
}
