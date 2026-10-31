/**
 * The Immich proxy forwards an allowlist of routes only (src/lib/server/immich-proxy-allowlist.ts).
 * Unit half: every route MiGallery's pages use is allowed, and the rest is refused. Server half:
 * the running handler answers 404 for a refused route before anything reaches Immich.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  canonicalProxiedPath,
  findProxyRule,
  publicAssetId,
} from '../src/lib/server/immich-proxy-allowlist.ts';
import { setupTestAuth, teardownTestAuth, globalTestContext } from './test-helpers';

const ID = '0b1c2d3e-4f50-4617-8899-aabbccddeeff';
const q = (s = '') => new URLSearchParams(s);
/** As the proxy decides: the canonical path first, then the list. */
const allowed = (method: string, path: string, query = '') => {
  const clean = canonicalProxiedPath(path);
  return clean !== null && findProxyRule(method, clean, q(query)) !== null;
};

describe('findProxyRule', () => {
  it('allows every route the pages use', () => {
    for (const [method, path, query] of [
      ['GET', `assets/${ID}`, ''],
      ['HEAD', `assets/${ID}`, ''],
      ['GET', `assets/${ID}/thumbnail`, 'size=preview'],
      ['GET', `assets/${ID}/original`, ''],
      ['GET', `assets/${ID}/video/playback`, ''],
      ['POST', 'assets', ''],
      ['DELETE', 'assets', ''],
      ['GET', 'assets', 'chunk-status=1'],
      ['GET', `albums/${ID}`, ''],
      ['GET', 'timeline/buckets', 'isTrashed=true&size=MONTH'],
      ['GET', 'timeline/bucket', 'timeBucket=x&isTrashed=true'],
      ['POST', 'trash/restore/assets', ''],
    ] as const) {
      expect(allowed(method, path, query), `${method} ${path}`).toBe(true);
    }
  });

  it('refuses the sync stream and every route the pages do not use', () => {
    for (const [method, path] of [
      ['POST', 'sync/stream'],
      ['POST', 'sync/full-sync'],
      ['POST', 'search/metadata'],
      ['GET', `people/${ID}`],
      ['GET', `people/${ID}/thumbnail`],
      ['PUT', `people/${ID}`],
      ['DELETE', `albums/${ID}/assets`],
      ['POST', `albums/${ID}/assets`],
      ['GET', `x/timeline/buckets`],
      ['GET', 'people'],
      ['GET', `faces`],
      ['GET', `faces/${ID}`],
      ['POST', 'search/person'],
      ['POST', 'search/smart'],
      ['GET', 'users'],
      ['GET', 'server/version'],
      ['POST', 'albums'],
      ['PUT', `albums/${ID}`],
      ['DELETE', `albums/${ID}`],
      ['DELETE', `people/${ID}`],
      ['PUT', `assets/${ID}`],
      ['DELETE', `assets/${ID}`],
      ['POST', 'download/archive'],
      ['GET', 'assets'],
      ['GET', `assets/${ID}/faces`],
      ['GET', `people/${ID}/statistics`],
      ['GET', 'assets/not-an-id/thumbnail'],
    ] as const) {
      expect(allowed(method, path), `${method} ${path}`).toBe(false);
    }
  });

  it('judges the path Immich would route, not the one it was spelled as', () => {
    expect(allowed('POST', 'SYNC/Stream')).toBe(false);
    expect(allowed('POST', `assets/${ID}/../../sync/stream`)).toBe(false);
    expect(allowed('POST', `assets/./../sync//stream`)).toBe(false);
    expect(allowed('GET', `ASSETS/${ID.toUpperCase()}/Thumbnail`)).toBe(true);
    expect(allowed('GET', `assets//${ID}`)).toBe(true);
    // A decoded `?` or `#` would start a query of its own: refused outright.
    expect(canonicalProxiedPath(`assets/${ID}?x=1`)).toBeNull();
    expect(allowed('GET', `assets/${ID}#x`)).toBe(false);
  });

  it('resolves encoded dot segments as the forwarded URL would, and refuses a second level of encoding', () => {
    // The router decodes once: `%252e` arrives here as `%2e`, which the URL parser resolves.
    expect(canonicalProxiedPath(`assets/${ID}/thumbnail/%2e%2e/%2e%2e/${ID}/original`)).toBe(
      `assets/${ID}/original`
    );
    expect(canonicalProxiedPath(`assets/${ID}/thumbnail/%2E%2e/%2e./%2e%2e/people/${ID}`)).toBe(
      `people/${ID}`
    );
    expect(canonicalProxiedPath(`assets/${ID}/%252e%252e/x`)).toBeNull();
    expect(canonicalProxiedPath(`assets/${ID}/thumbnail%00`)).toBeNull();
    // Out of /api/ altogether.
    expect(canonicalProxiedPath('../../etc/passwd')).toBeNull();
  });

  it('serves the public exception for one exact asset path only', () => {
    expect(publicAssetId(`assets/${ID}/thumbnail`)).toBe(ID);
    expect(publicAssetId(`assets/${ID}/video/playback`)).toBe(ID);
    expect(publicAssetId(`assets/${ID}/preview`)).toBeNull();
    expect(publicAssetId(`assets/${ID}/thumbnail/x`)).toBeNull();
    expect(publicAssetId(`x/assets/${ID}/thumbnail`)).toBeNull();
  });

  it('marks the trash routes as admin only', () => {
    expect(findProxyRule('GET', 'timeline/buckets', q())?.admin).toBe(true);
    expect(findProxyRule('POST', 'trash/restore/assets', q())?.admin).toBe(true);
    expect(findProxyRule('GET', `assets/${ID}`, q())?.admin).toBeFalsy();
  });
});

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';

describe('the proxy handler', () => {
  beforeAll(async () => {
    await setupTestAuth();
  });
  afterAll(async () => {
    if (globalTestContext.adminApiKey) {
      await teardownTestAuth(globalTestContext as import('./test-helpers').TestContext);
    }
  });

  const send = (method: string, path: string, body?: unknown) =>
    fetch(`${API_BASE_URL}/api/immich/${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-api-key': globalTestContext.adminApiKey || '',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });

  it('answers 404 for the sync stream and a route outside the allowlist, even to an admin key', async () => {
    const sync = await send('POST', 'sync/stream', { types: ['PeopleV1', 'AssetFacesV1'] });
    expect(sync.status).toBe(404);
    expect(await sync.json()).toEqual({ error: 'Not available through this proxy' });
    expect((await send('GET', 'server/version')).status).toBe(404);
  }, 15000);

  it('takes an allowed route past the list (no Immich here: it stops at the configuration)', async () => {
    const res = await send('GET', `assets/${ID}`);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'Immich is not configured' });
  }, 15000);
});
