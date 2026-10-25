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
    expect(location.origin).toBe('https://idp.test.invalid');
    expect(location.pathname).toBe('/application/o/authorize/');
    expect(location.searchParams.get('client_id')).toBe('test-client-id');
  });

  it('reports the database as connected through bun:sqlite', async () => {
    const response = await fetch(`${API_BASE_URL}/api/health`);

    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string; database: string };
    expect(body).toMatchObject({ status: 'ok', database: 'connected' });
  });
});
