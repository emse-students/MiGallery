import { describe, it, expect } from 'vitest';
import { cacheControlFor } from '../src/lib/server/cache-policy';

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';

/**
 * WHO A RESPONSE WAS MADE FOR DECIDES WHO MAY KEEP IT: a page is rendered for the member who asked
 * for it, so it is `private, no-store`; a file of the build is the same for everyone.
 */
describe('the cache policy of a response', () => {
  it.each([
    '/',
    '/albums',
    '/albums/1f0c0000-0000-4000-8000-000000000001',
    '/mes-photos',
    '/x.html',
  ])('a page is for this member only and never stored (%s)', (path) => {
    expect(cacheControlFor(path, 'text/html')).toBe('private, no-store');
    expect(cacheControlFor(path, 'text/html; charset=utf-8')).toBe('private, no-store');
  });

  it('a file of the build, a static picture and a font are shared and immutable', () => {
    for (const path of ['/_app/immutable/chunks/a.js', '/logo.png', '/fonts/inter.woff2']) {
      expect(cacheControlFor(path, 'application/octet-stream')).toBe(
        'public, max-age=172800, immutable'
      );
    }
  });

  it('an API route keeps the policy it set, whatever its path ends with', () => {
    expect(cacheControlFor('/api/users/me', 'application/json')).toBeNull();
    expect(cacheControlFor('/api/albums/a/cover.jpg', 'image/jpeg')).toBeNull();
    expect(cacheControlFor('/api/anything.html', 'text/html')).toBeNull();
  });

  it('another public file is shared and re-asked every time', () => {
    expect(cacheControlFor('/robots.txt', 'text/plain')).toBe('public, max-age=0, must-revalidate');
    expect(cacheControlFor('/manifest.webmanifest', null)).toBe(
      'public, max-age=0, must-revalidate'
    );
  });
});

describe('the server applies it', () => {
  it('a page comes back private and not stored', async () => {
    const page = await fetch(`${API_BASE_URL}/`, { redirect: 'manual' });

    expect(page.status).toBe(200);
    expect(page.headers.get('content-type') ?? '').toContain('text/html');
    expect(page.headers.get('cache-control')).toBe('private, no-store');
  });

  it('an API answer is not relabelled by the hook', async () => {
    const health = await fetch(`${API_BASE_URL}/api/health`);

    expect(health.headers.get('cache-control') ?? '').not.toContain('immutable');
    expect(health.headers.get('cache-control') ?? '').not.toContain('must-revalidate');
  });
});
