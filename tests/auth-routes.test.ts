/**
 * The route classes a framework migration can break, asserted against the BUILT server with the
 * Host header production sends. Each of these answered correctly or wrongly with a green build
 * on Sky (an external `redirect()` with no allowlist returned 500 on /auth/login), so the answer
 * is read from the running process rather than inferred from the code.
 */
import { describe, it, expect } from 'vitest';

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';
const PUBLIC_HOST = 'gallery.mitv.fr';
const get = (path: string, init: RequestInit = {}) =>
  fetch(`${API_BASE_URL}${path}`, {
    redirect: 'manual',
    ...init,
    headers: { Host: PUBLIC_HOST, ...(init.headers as Record<string, string>) },
  });

describe('sign-in', () => {
  it('redirects to the issuer with the public redirect_uri and Secure HttpOnly state cookies', async () => {
    const response = await get('/api/auth/login');

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location') ?? '');
    expect(location.origin).toBe('https://idp.test.invalid');
    expect(location.searchParams.get('redirect_uri')).toBe(
      `https://${PUBLIC_HOST}/api/auth/callback`
    );
    const cookies = response.headers.getSetCookie();
    for (const name of ['__oidc_state', '__oidc_nonce']) {
      const cookie = cookies.find((c) => c.startsWith(`${name}=`));
      expect(cookie, name).toBeDefined();
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/Secure/i);
    }
  });

  it('answers a clean 4xx to a callback it cannot trust, never a 500', async () => {
    const forged = await get('/api/auth/callback?code=x&state=forged', {
      headers: { Cookie: '__oidc_state=real' },
    });
    expect(forged.status).toBe(400);

    const noCode = await get('/api/auth/callback');
    expect(noCode.status).toBe(400);

    // The state matches, the identity provider (an unresolvable name here) refuses or is down.
    const refused = await get('/api/auth/callback?code=forged&state=ok', {
      headers: { Cookie: '__oidc_state=ok' },
    });
    expect(refused.status).toBe(401);
  });

  it('logs out with a redirect home and clears the session cookie', async () => {
    const response = await get('/api/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/');
    expect(response.headers.getSetCookie().join(';')).toMatch(/migallery_session=;/);
  });
});

describe('public and guarded routes', () => {
  it('serves a public page and redirects a guarded one to the sign-in', async () => {
    expect((await get('/cgu')).status).toBe(200);

    const guarded = await get('/albums');
    expect(guarded.status).toBe(303);
    expect(guarded.headers.get('location')).toContain('redirectTo=%2Falbums');
  });

  it('refuses an unsigned or wrongly signed avatar, and an unkeyed presence lookup, without a 500', async () => {
    expect((await get('/api/users/abc/avatar')).status).toBe(401);
    expect((await get('/api/users/abc/avatar?sig=deadbeef')).status).toBe(403);
    expect((await get('/api/users/avatar-presence?ids=a,b')).status).toBe(401);
  });

  it('refuses the Immich proxy and a keyed API route with a bogus key', async () => {
    expect((await get('/api/immich/assets/x/thumbnail')).status).toBe(401);
    expect(
      (await get('/api/immich/assets/x/thumbnail', { headers: { 'x-api-key': 'bogus' } })).status
    ).toBe(403);
    expect((await get('/api/albums', { headers: { 'x-api-key': 'bogus' } })).status).toBe(403);
  });
});
