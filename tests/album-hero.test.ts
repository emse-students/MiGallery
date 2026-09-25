/**
 * The album page header (`src/lib/album-hero.ts`): its two images and its date line.
 *
 * Pure functions, no server needed.
 */

import { describe, it, expect } from 'vitest';
import { albumHeroSources, formatAlbumDate } from '$lib/album-hero';

describe('albumHeroSources', () => {
  it('uses the preview for the hero and the versioned square cover for the backdrop', () => {
    expect(albumHeroSources({ albumId: 'alb', coverAssetId: 'c1' })).toEqual({
      hero: '/api/immich/assets/c1/thumbnail?size=preview',
      backdrop: '/api/albums/alb/cover?v=c1',
    });
  });

  it("routes an unlisted album's hero through the album", () => {
    expect(
      albumHeroSources({ albumId: 'alb', coverAssetId: 'c1', visibility: 'unlisted' }).hero
    ).toBe('/api/albums/alb/asset-thumbnail/c1/thumbnail?size=preview');
  });

  it('draws no image for an album without a cover', () => {
    expect(albumHeroSources({ albumId: 'alb', coverAssetId: null })).toEqual({
      hero: null,
      backdrop: null,
    });
  });
});

describe('formatAlbumDate', () => {
  it('prints a short date in the page language', () => {
    expect(formatAlbumDate('2025-09-13', 'fr')).toBe('13 sept. 2025');
    expect(formatAlbumDate('2025-09-13', 'en')).toBe('13 Sept 2025');
  });

  it('prints nothing for a missing or malformed date', () => {
    expect(formatAlbumDate(null, 'fr')).toBeNull();
    expect(formatAlbumDate('', 'fr')).toBeNull();
    expect(formatAlbumDate('13/09/2025', 'fr')).toBeNull();
  });
});
