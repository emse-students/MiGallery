import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import {
  canonicalUrl,
  DEFAULT_IMAGE,
  defaultImage,
  isIndexable,
  jsonLdScript,
  siteNode,
  siteSeo,
} from '$lib/seo';

/**
 * Two audiences. A search engine gets the home page ALONE (`static/robots.txt`, the `robots` meta and
 * the `X-Robots-Tag` header all read `isIndexable`). And what a pasted album link becomes in a chat is
 * a separate matter: an unfurler is not a crawler, it fetches the URL it was given and never reads
 * robots.txt.
 *
 * The properties worth pinning are the ones that fail SILENTLY - a relative image URL no unfurler
 * can resolve, and a card built from a constant origin rather than the request's, which is right in
 * production and wrong everywhere else. Neither breaks a page render, so neither shows up until
 * somebody notices a preview that never appears.
 */

describe('absolute URLs', () => {
  it('builds the fallback image and the canonical from the request origin', () => {
    expect(defaultImage('https://gallery.mitv.fr')).toBe('https://gallery.mitv.fr/og-image.jpg');
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

describe('DEFAULT_IMAGE', () => {
  it('declares the size and type the file in static/ actually has', async () => {
    const meta = await sharp(`static${DEFAULT_IMAGE.path}`).metadata();
    expect(meta.width).toBe(DEFAULT_IMAGE.width);
    expect(meta.height).toBe(DEFAULT_IMAGE.height);
    expect(`image/${meta.format}`).toBe(DEFAULT_IMAGE.type);
  });
});

describe('isIndexable', () => {
  it('allows the home page and nothing else', () => {
    expect(isIndexable('/')).toBe(true);
  });

  it('refuses albums, photos, the API, the login chain and a route nobody has written yet', () => {
    for (const path of [
      '/albums',
      '/albums/42',
      '/mes-photos',
      '/photos-cv',
      '/api/albums',
      '/admin',
      '/cgu',
      '/nouvelle-route',
    ]) {
      expect(isIndexable(path)).toBe(false);
    }
  });
});

describe('siteNode', () => {
  it('is built from the request origin and names no photo, album or person', () => {
    const node = siteNode('http://localhost:5173');
    expect(node['@id']).toBe('http://localhost:5173/#website');
    expect(node.url).toBe('http://localhost:5173/');
    // The PROPERTIES, not the prose: the description says "photothèque" and that is fine.
    const properties = Object.keys(node).map((key) => key.toLowerCase());
    for (const key of ['image', 'photo', 'author', 'creator', 'person', 'hasPart', 'about']) {
      expect(properties).not.toContain(key.toLowerCase());
    }
  });
});

describe('jsonLdScript', () => {
  const OPEN = '<script type="application/ld+json">';
  const CLOSE = '</script>';
  const unwrap = (out: string) => {
    expect(out.startsWith(OPEN)).toBe(true);
    expect(out.endsWith(CLOSE)).toBe(true);
    return out.slice(OPEN.length, out.length - CLOSE.length);
  };

  it('wraps the nodes in a schema.org graph', () => {
    const parsed = JSON.parse(unwrap(jsonLdScript([{ '@type': 'WebSite' }])));
    expect(parsed['@context']).toBe('https://schema.org');
    expect(parsed['@graph']).toEqual([{ '@type': 'WebSite' }]);
  });

  it('cannot close the script element it is embedded in', () => {
    const inner = unwrap(jsonLdScript([{ name: '</script><img src=x onerror=alert(1)>' }]));
    expect(inner).not.toContain('<');
    expect(JSON.parse(inner)['@graph'][0].name).toBe('</script><img src=x onerror=alert(1)>');
  });

  it('escapes ampersands too, so an entity in a name survives verbatim', () => {
    const inner = unwrap(jsonLdScript([{ name: 'Arts &amp; Metiers' }]));
    expect(inner).not.toContain('&');
    expect(JSON.parse(inner)['@graph'][0].name).toBe('Arts &amp; Metiers');
  });
});
