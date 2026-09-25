/**
 * Everything the home page draws from chance or from the clock, derived from ONE value the server
 * picks. The server render and the client hydration used to draw their own: `Math.random()` ran twice,
 * so the background blobs visibly jumped to a second set once the page hydrated, and the greeting read
 * the server's clock and then the browser's, flipping "Bonsoir" to "Bonjour" in the middle of a night.
 * Both halves now read `FirstPaint` from the root layout's data, which SvelteKit serializes into the
 * page - the two renders agree by construction, and a client navigation keeps the same set.
 */

/** The seed and the instant every first-paint decision derives from. */
export interface FirstPaint {
  seed: number;
  at: number;
}

/** A blob of the page background, positioned in CSS units. */
export interface BlobData {
  id: number;
  top: string;
  left: string;
  width: string;
  height: string;
  color: string;
}

const BLOB_COLORS = ['#FF3F3F', '#FF44EC', '#AC52FF', '#5B6CFF', '#2DD4BF', '#F59E0B'];
const BLOB_COUNT = 6;

/** Picked once per page load, on the server. */
export function newFirstPaint(now = Date.now()): FirstPaint {
  return { seed: Math.floor(Math.random() * 2 ** 32), at: now };
}

/** mulberry32: a small seeded generator, so one seed always yields the same sequence. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The background blobs for a seed - identical wherever it is called. */
export function blobsFor(seed: number): BlobData[] {
  const next = seeded(seed);
  const between = (min: number, max: number) => next() * (max - min) + min;
  return Array.from({ length: BLOB_COUNT }, (_, id) => ({
    id,
    top: `${between(-20, 80)}%`,
    left: `${between(-20, 80)}%`,
    width: `${between(60, 90)}vw`,
    height: `${between(60, 90)}vw`,
    color: BLOB_COLORS[Math.floor(next() * BLOB_COLORS.length)],
  }));
}

/** Which greeting a moment calls for. `night` carries which of its variants. */
export type Greeting = { kind: 'day' } | { kind: 'evening' } | { kind: 'night'; variant: number };

/** How many night greetings exist in `messages/*.json` (`greeting_night_0..N-1`). */
export const NIGHT_VARIANTS = 3;

/**
 * The greeting for an instant, read on the Paris clock: every user is in Saint-Etienne, and a
 * container's clock is UTC, which is what split the two renders. Night is midnight to 5 a.m.; its
 * variant changes with the day, never with the render.
 */
export function greetingAt(at: number): Greeting {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Paris',
    hour: 'numeric',
    hourCycle: 'h23',
    day: 'numeric',
  }).formatToParts(new Date(at));
  const hour = Number(parts.find((p) => p.type === 'hour')?.value);
  const day = Number(parts.find((p) => p.type === 'day')?.value);
  if (hour < 5) return { kind: 'night', variant: day % NIGHT_VARIANTS };
  return hour < 18 ? { kind: 'day' } : { kind: 'evening' };
}
