/**
 * The built server (bun, adapter-bun) hands its declared environment to SvelteKit code.
 *
 * Kit 3 exposes ONLY the variables listed in `src/env.ts`: an undeclared one reads as `undefined`
 * with no error, which shipped here as a login redirecting to `/authorize/?client_id=undefined`
 * and would have shipped as an Immich proxy without its API key. Nothing else in the suite sees
 * it, because every other test runs with an empty Immich and never signs in.
 */
import { describe, it, expect } from 'vitest';

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';

describe('server environment', () => {
  it('reaches the login redirect: issuer origin, client id, and an allowed external redirect', async () => {
    const response = await fetch(`${API_BASE_URL}/api/auth/login`, { redirect: 'manual' });

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location') ?? '');
    // The run's fake provider (scripts/test-with-server.mjs).
    expect(location.origin).toBe(new URL(process.env.MICONNECT_ISSUER ?? '').origin);
    expect(location.pathname).toBe('/application/o/authorize/');
    expect(location.searchParams.get('client_id')).toBe('test-client-id');
  });

  it('derives the origin from the Host header, never from the build', async () => {
    // adapter-bun assumes https and trusts the Host the proxy forwards. A baked-in origin would
    // send every dev, preview or local build's redirect_uri to production.
    const host = 'gallery.host-derivation.test';
    const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
      redirect: 'manual',
      headers: { Host: host },
    });

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location') ?? '');
    expect(location.searchParams.get('redirect_uri')).toBe(`https://${host}/api/auth/callback`);

    const page = await fetch(`${API_BASE_URL}/cgu`, { headers: { Host: host } });
    expect(await page.text()).toContain(`https://${host}/cgu`);
  });

  it('refuses a body-less mutation that has no Origin and no Content-Type (kit 3 contract)', async () => {
    // Answered by the framework before hooks.server.ts, so it cannot be opted out per route:
    // docs/wiki/api-reference.md makes `Content-Type` part of the API for every client.
    const bare = await fetch(`${API_BASE_URL}/api/external/media/none`, {
      method: 'DELETE',
      headers: { 'x-api-key': 'not-a-key' },
    });
    expect(bare.status).toBe(403);
    expect(await bare.text()).toContain('Cross-site DELETE form submissions are forbidden');

    const typed = await fetch(`${API_BASE_URL}/api/external/media/none`, {
      method: 'DELETE',
      headers: { 'x-api-key': 'not-a-key', 'Content-Type': 'application/json' },
    });
    // The handler answers its own 403 for a bad key; only the framework's message is the contract.
    expect(await typed.text()).not.toContain('Cross-site');
  });

  it('reports the database as connected through bun:sqlite', async () => {
    const response = await fetch(`${API_BASE_URL}/api/health`);

    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string; database: string };
    expect(body).toMatchObject({ status: 'ok', database: 'connected' });
  });
});
