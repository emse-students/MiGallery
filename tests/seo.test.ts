import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import sharp from 'sharp';
import {
  canonicalUrl,
  CRAWLABLE_STATIC_FILES,
  DEFAULT_IMAGE,
  defaultImage,
  INDEXABLE_PATHS,
  isIndexable,
  robotsDirective,
  robotsTxt,
  siteSeo,
  sitemapXml,
} from '$lib/seo';
import { normalizeOrigin, siteOrigin } from '$lib/server/site-origin';
import { env } from '$env/dynamic/private';
import { TEST_CONFIG } from './test-helpers';

/**
 * Two audiences read MiGallery's head (docs/wiki/seo.md): a search engine, for the PUBLIC pages
 * only, and an unfurler, for every shared link.
 *
 * The properties worth pinning are the ones that fail SILENTLY: a private page left indexable, an
 * album leaking into the sitemap, a canonical built from the host a request reached rather than the
 * configured one, a relative image URL no unfurler can resolve. None of them breaks a page render.
 */

const ORIGIN = 'https://gallery.example.org';

describe('absolute URLs', () => {
  it('builds the fallback image and the canonical from the given origin', () => {
    expect(defaultImage(ORIGIN)).toBe(`${ORIGIN}/og-image.jpg`);
    expect(canonicalUrl('http://localhost:5173', '/albums/42')).toBe(
      'http://localhost:5173/albums/42'
    );
  });
});

describe('siteOrigin', () => {
  const saved = env.ORIGIN;
  afterEach(() => {
    env.ORIGIN = saved;
  });

  it('is ORIGIN when it is configured, whatever host the request reached', () => {
    env.ORIGIN = `${ORIGIN}/`;
    expect(siteOrigin('http://10.0.0.5:3000')).toBe(ORIGIN);
  });

  it('is the request origin only when ORIGIN is absent or not an http(s) URL', () => {
    env.ORIGIN = undefined;
    expect(siteOrigin('http://localhost:5173')).toBe('http://localhost:5173');
    env.ORIGIN = 'ftp://gallery.example.org';
    expect(siteOrigin('http://localhost:5173')).toBe('http://localhost:5173');
  });

  it('normalizes to scheme, host and port - no path, no trailing slash', () => {
    expect(normalizeOrigin('https://gallery.example.org/some/path')).toBe(ORIGIN);
    expect(normalizeOrigin('http://localhost:3000/')).toBe('http://localhost:3000');
    expect(normalizeOrigin('not a url')).toBeNull();
    expect(normalizeOrigin('')).toBeNull();
  });
});

describe('the indexable surface', () => {
  it('is the home page and the terms, and nothing that needs a session', () => {
    expect([...INDEXABLE_PATHS]).toEqual(['/', '/cgu']);
    for (const path of ['/albums', '/albums/42', '/mes-photos', '/admin', '/api/health']) {
      expect(isIndexable(path)).toBe(false);
      expect(robotsDirective(path)).toBe('noindex, nofollow');
    }
    expect(robotsDirective('/')).toBe('index, follow');
    expect(robotsDirective('/cgu')).toBe('index, follow');
    expect(isIndexable('/cgu/anything')).toBe(false);
  });

  it('has no server guard on any indexable page - an indexed URL must not redirect', () => {
    // Every sign-in guard in this app lives in a `+page.server.ts` (or an admin layout). An
    // indexable page that grows one would be a URL in the sitemap answering 303.
    for (const path of INDEXABLE_PATHS) {
      const dir = `src/routes${path === '/' ? '' : path}`;
      expect(existsSync(`${dir}/+page.svelte`)).toBe(true);
      expect(existsSync(`${dir}/+page.server.ts`)).toBe(false);
    }
  });
});

describe('robots.txt', () => {
  const txt = robotsTxt(ORIGIN);

  it('names the sitemap by absolute URL from the configured origin', () => {
    expect(txt).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`);
  });

  it('is an allowlist: the public pages exactly, then Disallow everything else', () => {
    expect(txt).toContain('Allow: /$');
    expect(txt).toContain('Allow: /cgu$');
    expect(txt.trim().split('\n')).toContain('Disallow: /');
    // Nothing private is opened by prefix.
    for (const line of txt.split('\n').filter((l) => l.startsWith('Allow:'))) {
      expect(line).not.toMatch(/\/(api|admin|albums|mes-photos|parametres|photos-cv|dev)\b/);
    }
  });

  it('allows every file in static/, so a public page renders whole for a crawler', () => {
    const files = readdirSync('static').map((f) => `/${f}`);
    expect([...CRAWLABLE_STATIC_FILES].sort()).toEqual(files.sort());
  });
});

describe('sitemap.xml', () => {
  const xml = sitemapXml(ORIGIN);

  it('lists exactly the indexable pages, absolute, and no album', () => {
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((x) => x[1]);
    expect(locs).toEqual([`${ORIGIN}/`, `${ORIGIN}/cgu`]);
    expect(xml).not.toContain('/albums');
  });

  it('escapes the origin, which comes from configuration', () => {
    expect(sitemapXml('https://a.example?x=1&y=2')).toContain('x=1&amp;y=2');
  });
});

describe('siteSeo', () => {
  it('is a complete card on its own, so a page that contributes nothing still unfurls', () => {
    const seo = siteSeo();
    expect(seo.title).toBe('MiGallery');
    expect(seo.description).toBeTruthy();
    expect(seo.imageAlt).toBeTruthy();
  });

  it('declares no image and no size - the layout falls back to the site logo', () => {
    const seo = siteSeo();
    expect(seo.image).toBeNull();
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

/**
 * Against the suite's own server (`bun run test` starts it with `ORIGIN` = its own URL): what a
 * crawler is actually SERVED, which is the only thing it ever sees.
 */
describe('served by the running app', () => {
  const base = TEST_CONFIG.API_BASE_URL;

  it('answers robots.txt and sitemap.xml with a 200, never a redirect', async () => {
    const robots = await fetch(`${base}/robots.txt`, { redirect: 'manual' });
    expect(robots.status).toBe(200);
    expect(robots.headers.get('content-type')).toContain('text/plain');
    expect(await robots.text()).toContain(`Sitemap: ${base}/sitemap.xml`);

    const sitemap = await fetch(`${base}/sitemap.xml`, { redirect: 'manual' });
    expect(sitemap.status).toBe(200);
    expect(sitemap.headers.get('content-type')).toContain('application/xml');
    expect(await sitemap.text()).toContain(`<loc>${base}/cgu</loc>`);
  });

  it('serves each public page indexable, with one description and a canonical', async () => {
    for (const path of INDEXABLE_PATHS) {
      const res = await fetch(`${base}${path}`, { redirect: 'manual' });
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('<meta name="robots" content="index, follow"');
      expect(html).toContain(`<link rel="canonical" href="${base}${path}"`);
      expect(html.match(/<meta name="description"/g)).toHaveLength(1);
    }
  });

  it('sends an anonymous visitor of a private page to the sign-in, not to an indexable page', async () => {
    const res = await fetch(`${base}/albums`, { redirect: 'manual' });
    expect(res.status).toBe(303);
  });
});
