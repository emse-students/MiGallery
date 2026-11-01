/**
 * Why the confirmation screen's tiles stayed empty, and the loader that fixes it
 * (src/lib/face-crop-loader.ts). The server side is the ONE Sharp pool every image endpoint shares
 * (sharp-limit.ts): a burst beyond its slots and queue is refused at once (`busy`, a 503). The
 * client side is the loader: a few crops at a time, `Retry-After` honoured, every other failure
 * final for the attempt (the tile shows a retry). SYNTHETIC responses only.
 */
import { describe, expect, it } from 'vitest';
import { acquireSharp } from '#lib/server/sharp-limit.ts';
import { BUSY_RETRIES, CropLoadError, CropLoader, retryAfterMs } from '#lib/face-crop-loader.ts';

describe('the cause: a burst of crops overflows the shared Sharp pool', () => {
  it('refuses at once every request past 4 running and 12 waiting', async () => {
    // A desktop grid of suggestions asked every visible crop at once, as plain lazy <img> did.
    const asked = await Promise.all(
      Array.from({ length: 30 }, () => Promise.race([acquireSharp(), Promise.resolve('waiting')]))
    );
    const refused = asked.filter((r) => r === null).length;
    expect(refused).toBe(14);
    // Release what was granted so the pool is clean for the next test.
    for (const r of asked) if (typeof r === 'function') r();
    await new Promise((r) => setTimeout(r, 0));
  });
});

/** A fake crop server: answers 503 (busy) past `capacity` requests at once, else after `delayMs`. */
function fakeServer(capacity: number, delayMs = 2) {
  let open = 0;
  let peak = 0;
  const calls: string[] = [];
  const fetchFn = async (url: string) => {
    calls.push(url);
    if (open >= capacity) {
      return new Response('busy', { status: 503, headers: { 'Retry-After': '2' } });
    }
    open++;
    peak = Math.max(peak, open);
    await new Promise((r) => setTimeout(r, delayMs));
    open--;
    return new Response(new Blob(['webp']), { status: 200 });
  };
  return { fetchFn, calls, peak: () => peak };
}

const noWait = async () => undefined;

describe('the loader', () => {
  it('loads every one of 40 crops from a server that refuses past 16 at once', async () => {
    const server = fakeServer(16);
    const loader = new CropLoader({ fetchFn: server.fetchFn, wait: noWait });
    const results = await Promise.allSettled(
      Array.from({ length: 40 }, (_, i) => loader.load(`/crop/${i}`))
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(40);
    expect(server.peak()).toBeLessThanOrEqual(3);
    // Unpaced (what the plain <img> did), the same burst loses crops.
    const direct = fakeServer(16);
    const unpaced = await Promise.all(
      Array.from({ length: 40 }, (_, i) => direct.fetchFn(`/crop/${i}`))
    );
    expect(unpaced.filter((r) => r.status === 503).length).toBeGreaterThan(0);
  });

  it('waits out a busy answer as long as the server asks, then fails on the third', async () => {
    const waits: number[] = [];
    let n = 0;
    const loader = new CropLoader({
      fetchFn: async () =>
        ++n <= 2
          ? new Response('', { status: 503, headers: { 'Retry-After': '3' } })
          : new Response(new Blob(['ok'])),
      wait: async (ms) => {
        waits.push(ms);
      },
    });
    await expect(loader.load('/c')).resolves.toBeInstanceOf(Blob);
    expect(waits).toEqual([3000, 3000]);

    const busy = new CropLoader({
      fetchFn: async () => new Response('', { status: 503 }),
      wait: noWait,
    });
    await expect(busy.load('/c')).rejects.toMatchObject({ status: 503 });
    expect(BUSY_RETRIES).toBe(2);
  });

  it('never retries another failure: a 404 is final and says so', async () => {
    let calls = 0;
    const loader = new CropLoader({
      fetchFn: async () => {
        calls++;
        return new Response('', { status: 404 });
      },
      wait: noWait,
    });
    const err = await loader.load('/c').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CropLoadError);
    expect((err as CropLoadError).status).toBe(404);
    expect(calls).toBe(1);
    const down = new CropLoader({
      fetchFn: async () => {
        throw new TypeError('network');
      },
      wait: noWait,
    });
    await expect(down.load('/c')).rejects.toMatchObject({ status: 0 });
  });

  it('drops a waiting request whose tile left, without asking the server', async () => {
    const server = fakeServer(16, 20);
    const loader = new CropLoader({ fetchFn: server.fetchFn, wait: noWait, concurrency: 1 });
    const first = loader.load('/first');
    const gone = new AbortController();
    const second = loader.load('/second', gone.signal);
    gone.abort();
    await expect(second).rejects.toThrow();
    await first;
    expect(server.calls).toEqual(['/first']);
    expect(loader.active).toBe(0);
  });

  it('reads Retry-After in seconds, and 2 s when it is missing', () => {
    expect(retryAfterMs('5')).toBe(5000);
    expect(retryAfterMs(null)).toBe(2000);
    expect(retryAfterMs('soon')).toBe(2000);
  });
});
