import { describe, it, expect } from 'vitest';
import { canonicalUrl, defaultImage, siteSeo } from '$lib/seo';

/**
 * MiGallery refuses every crawler (`static/robots.txt`), so none of this is about search results.
 * It is about what a pasted album link becomes in a chat, and an unfurler is not a crawler: it
 * fetches the URL it was given and never reads robots.txt.
 *
 * The properties worth pinning are the ones that fail SILENTLY - a relative image URL no unfurler
 * can resolve, and a card built from a constant origin rather than the request's, which is right in
 * production and wrong everywhere else. Neither breaks a page render, so neither shows up until
 * somebody notices a preview that never appears.
 */

describe('absolute URLs', () => {
  it('builds the fallback image and the canonical from the request origin', () => {
    expect(defaultImage('https://gallery.mitv.fr')).toBe('https://gallery.mitv.fr/MiGallery.png');
    expect(canonicalUrl('http://localhost:5173', '/albums/42')).toBe(
      'http://localhost:5173/albums/42'
    );
  });

  it('drops query and hash - the same album under a filter is not a second page', () => {
    expect(canonicalUrl('https://gallery.mitv.fr', '/albums/42')).toBe(
      'https://gallery.mitv.fr/albums/42'
    );
  });
});

describe('siteSeo', () => {
  it('is a complete card on its own, so a page that contributes nothing still unfurls', () => {
    const seo = siteSeo();
    expect(seo.title).toBe('MiGallery');
    expect(seo.description).toBeTruthy();
    expect(seo.imageAlt).toBeTruthy();
  });

  it('declares no image, so the layout falls back to the site logo', () => {
    // The fallback belongs to the component, which knows the origin. A hard-coded absolute URL
    // here would be right on production and wrong in every other environment.
    expect(siteSeo().image).toBeNull();
  });

  it('claims no pixel dimensions - only the album cover endpoint knows its own', () => {
    const seo = siteSeo();
    expect(seo.imageWidth).toBeUndefined();
    expect(seo.imageHeight).toBeUndefined();
    expect(seo.imageType).toBeUndefined();
  });
});
