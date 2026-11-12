import { describe, it, expect } from 'vitest';
import { cacheControlFor } from '../src/lib/server/cache-policy';

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';

const PRIVATE = 'private, no-store';
const IMMUTABLE = 'public, max-age=172800, immutable';
const REVALIDATED = 'public, max-age=0, must-revalidate';

/**
 * WHO A RESPONSE WAS MADE FOR DECIDES WHO MAY KEEP IT, and the default is "this member only": only
 * an explicit list of files, actually served, is shared.
 */
describe('the cache policy of a response', () => {
  it.each([
    '/',
    '/albums',
    '/albums/1f0c0000-0000-4000-8000-000000000001',
    '/mes-photos',
    '/x.html',
    '/__data.json',
    '/albums/__data.json',
    '/albums/1f0c0000-0000-4000-8000-000000000001/__data.json',
  ])('a page and the data of a page are for this member only (%s)', (path) => {
    expect(cacheControlFor(path, 200)).toBe(PRIVATE);
  });

  it.each(['/mes-photos', '/parametres', '/admin/login-as', '/dev/login-as', '/albums'])(
    'a redirect depends on who asked, so it is never stored (%s)',
    (path) => {
      for (const status of [301, 302, 303, 307, 308]) {
        expect(cacheControlFor(path, status)).toBe(PRIVATE);
      }
    }
  );

  it('a file of the build, a static picture and a font are shared and immutable once served', () => {
    for (const path of ['/_app/immutable/chunks/a.js', '/logo.webp', '/fonts/inter.woff2']) {
      expect(cacheControlFor(path, 200)).toBe(IMMUTABLE);
      expect(cacheControlFor(path, 304)).toBe(IMMUTABLE);
    }
  });

  it('a path that looks like a file and was not served is not labelled as one', () => {
    for (const status of [303, 404, 500]) {
      expect(cacheControlFor('/nope.png', status)).toBe(PRIVATE);
      expect(cacheControlFor('/_app/immutable/chunks/gone.js', status)).toBe(PRIVATE);
      expect(cacheControlFor('/robots.txt', status)).toBe(PRIVATE);
    }
  });

  it('robots.txt and the manifest are shared and re-asked every time', () => {
    expect(cacheControlFor('/robots.txt', 200)).toBe(REVALIDATED);
    expect(cacheControlFor('/manifest.webmanifest', 200)).toBe(REVALIDATED);
  });

  it('a file nobody listed is not shared', () => {
    expect(cacheControlFor('/export.csv', 200)).toBe(PRIVATE);
    expect(cacheControlFor('/notes.txt', 200)).toBe(PRIVATE);
  });

  it('an API route keeps the policy it set, whatever its path ends with and answers', () => {
    expect(cacheControlFor('/api/users/me', 200)).toBeNull();
    expect(cacheControlFor('/api/albums/a/cover.jpg', 200)).toBeNull();
    expect(cacheControlFor('/api/anything.html', 404)).toBeNull();
  });
});

describe('the server applies it', () => {
  it('a page comes back private and not stored', async () => {
    const page = await fetch(`${API_BASE_URL}/`, { redirect: 'manual' });

    expect(page.status).toBe(200);
    expect(page.headers.get('content-type') ?? '').toContain('text/html');
    expect(page.headers.get('cache-control')).toBe(PRIVATE);
  });

  it('the data of a page comes back private and not stored', async () => {
    const data = await fetch(`${API_BASE_URL}/__data.json`, { redirect: 'manual' });

    expect(data.status).toBe(200);
    expect(data.headers.get('cache-control')).toBe(PRIVATE);
  });

  it('the redirect a signed-out visitor gets is private and not stored', async () => {
    const redirect = await fetch(`${API_BASE_URL}/mes-photos`, { redirect: 'manual' });

    expect(redirect.status).toBeGreaterThanOrEqual(300);
    expect(redirect.status).toBeLessThan(400);
    expect(redirect.headers.get('cache-control')).toBe(PRIVATE);
  });

  it('a picture that does not exist is not labelled immutable', async () => {
    const missing = await fetch(`${API_BASE_URL}/nope.png`, { redirect: 'manual' });

    expect(missing.status).toBe(404);
    expect(missing.headers.get('cache-control')).toBe(PRIVATE);
  });

  it('an API answer is not relabelled by the hook', async () => {
    const health = await fetch(`${API_BASE_URL}/api/health`);

    expect(health.headers.get('cache-control') ?? '').not.toContain('immutable');
    expect(health.headers.get('cache-control') ?? '').not.toContain('must-revalidate');
  });
});
