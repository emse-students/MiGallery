import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { leaveInAppBrowser, leaveInAppBrowserHandler } from '../src/lib/server/leaveInAppBrowser';

/**
 * This site's gate, as `hooks.server.ts` calls it: the shared fixtures through the real module, the
 * paths and requests that must pass, the answer's headers and the one log line.
 */
interface Case {
  name: string;
  userAgent: string;
  expect: unknown;
}

const { cases } = JSON.parse(
  readFileSync(resolve('tests/fixtures/leave-in-app-browser.fixtures.json'), 'utf8')
) as { cases: Case[] };
const messengerIos = cases.find((c) => c.name === 'Messenger, iOS 18')!.userAgent;
const messengerAndroid = cases.find((c) => c.name === 'Messenger, Android')!.userAgent;
const ORIGIN = 'https://gallery.mitv.fr';

/** A page navigation as a browser sends it, `headers` on top. */
function page(userAgent: string, headers: Record<string, string> = {}, method = 'GET') {
  return new Request(`${ORIGIN}/x`, {
    method,
    headers: {
      'user-agent': userAgent,
      accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
      'sec-fetch-dest': 'document',
      ...headers,
    },
  });
}

describe('leaveInAppBrowser', () => {
  const realLog = console.log;
  let lines: string[] = [];
  beforeEach(() => {
    lines = [];
    console.log = (line: string) => {
      lines.push(String(line));
    };
  });
  afterEach(() => {
    console.log = realLog;
  });

  it('answers every in-app fixture with the interstitial and lets every other client through', () => {
    const url = new URL('/posts/abc', ORIGIN);
    for (const c of cases) {
      const response = leaveInAppBrowser(page(c.userAgent), url);
      expect({ name: c.name, gated: response !== null }).toEqual({
        name: c.name,
        gated: c.expect !== null,
      });
    }
  });

  it('never gates an API call, an asset, an association file, an image, a fetch or a POST', () => {
    for (const path of [
      '/api/health',
      '/_app/immutable/entry/app.js',
      '/.well-known/assetlinks.json',
    ]) {
      expect(leaveInAppBrowser(page(messengerIos), new URL(path, ORIGIN))).toBeNull();
    }
    const image = page(messengerIos, { 'sec-fetch-dest': 'image', accept: 'image/*' });
    expect(leaveInAppBrowser(image, new URL('/icon.png', ORIGIN))).toBeNull();
    const fetched = page(messengerIos, { 'sec-fetch-dest': 'empty' });
    expect(leaveInAppBrowser(fetched, new URL('/posts/abc', ORIGIN))).toBeNull();
    expect(leaveInAppBrowser(page(messengerIos, {}, 'POST'), new URL('/x', ORIGIN))).toBeNull();
  });

  it('answers 200 with the page, no-store, Vary: User-Agent, noindex and its own CSP', async () => {
    const response = leaveInAppBrowser(page(messengerAndroid), new URL('/x', ORIGIN))!;
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('vary')).toBe('User-Agent');
    expect(response.headers.get('x-robots-tag')).toContain('noindex');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(await response.text()).toContain('<meta name="leave-iab-app" content="" />');
  });

  it('logs one line naming the site and the route, never the query', () => {
    leaveInAppBrowser(page(messengerAndroid), new URL('/c/join/secret-token?k=v', ORIGIN));
    expect(lines).toEqual([
      '[leave-iab] interstitial served site=migallery app=messenger os=android ios=- route=/c',
    ]);
  });

  it('the handle step answers an in-app browser itself and hands everyone else to resolve', async () => {
    let resolved = 0;
    const next = async () => {
      resolved += 1;
      return new Response('page');
    };
    const call = (request: Request) =>
      leaveInAppBrowserHandler({
        event: { request, url: new URL(request.url) },
        resolve: next,
      } as unknown as Parameters<typeof leaveInAppBrowserHandler>[0]);
    const gated = await call(page(messengerIos));
    expect(gated.headers.get('cache-control')).toBe('no-store');
    expect(resolved).toBe(0);
    const real = cases.find((c) => c.expect === null && c.userAgent.includes('Mozilla'))!;
    expect(await (await call(page(real.userAgent))).text()).toBe('page');
    expect(resolved).toBe(1);
  });
});
