import { describe, it, expect } from 'vitest';
import { blobsFor, greetingAt, newFirstPaint, NIGHT_VARIANTS } from '$lib/first-paint';

/**
 * The server render and the hydration must draw the same page: two independent `Math.random()`
 * calls made the blobs jump, and two clocks flipped the greeting. What is pinned is that a seed and
 * an instant decide everything, and that night is not "day".
 */

describe('blobsFor', () => {
  it('draws the same blobs for the same seed', () => {
    expect(blobsFor(1234)).toEqual(blobsFor(1234));
  });

  it('draws a different set for another seed', () => {
    expect(blobsFor(1)).not.toEqual(blobsFor(2));
  });

  it('keeps every blob inside the ranges the page was designed for', () => {
    for (const b of blobsFor(newFirstPaint().seed)) {
      expect(parseFloat(b.top)).toBeGreaterThanOrEqual(-20);
      expect(parseFloat(b.top)).toBeLessThan(80);
      expect(parseFloat(b.width)).toBeGreaterThanOrEqual(60);
      expect(parseFloat(b.width)).toBeLessThan(90);
      expect(b.color).toMatch(/^#[0-9A-F]{6}$/);
    }
  });
});

describe('greetingAt (Paris clock)', () => {
  // 2026-09-26 is summer time: Paris = UTC+2.
  const paris = (h: number) => Date.UTC(2026, 8, 26, h - 2, 30);

  it('says night after midnight, where "hour < 18" used to say Bonjour', () => {
    expect(greetingAt(paris(0)).kind).toBe('night');
    expect(greetingAt(paris(4)).kind).toBe('night');
  });

  it('says day from 5 a.m. and evening from 6 p.m.', () => {
    expect(greetingAt(paris(5)).kind).toBe('day');
    expect(greetingAt(paris(17)).kind).toBe('day');
    expect(greetingAt(paris(18)).kind).toBe('evening');
    expect(greetingAt(paris(23)).kind).toBe('evening');
  });

  it('reads Paris, not the machine: 23:30 UTC is already night in Paris', () => {
    expect(greetingAt(Date.UTC(2026, 8, 25, 23, 30)).kind).toBe('night');
  });

  it('picks the night variant from the day, so both renders agree', () => {
    const g = greetingAt(paris(2));
    expect(g).toEqual(greetingAt(paris(3)));
    if (g.kind === 'night') expect(g.variant).toBeLessThan(NIGHT_VARIANTS);
  });
});
