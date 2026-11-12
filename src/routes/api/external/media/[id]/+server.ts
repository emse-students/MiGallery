import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '#lib/server/env.ts';
import { requireScope } from '#lib/server/permissions.ts';
import { assertImmichId } from '#lib/server/immich-id.ts';
import { requireAssetRead } from '#lib/server/asset-access.ts';
import { assertProxiedDeleteAllowed } from '#lib/server/immich-proxy-allowlist.ts';
import { OUTBOUND_BUDGET_MS, fetchWithAnswerDeadline } from '#lib/server/outbound.ts';

const IMMICH_BASE_URL = env.IMMICH_BASE_URL;
const IMMICH_API_KEY = env.IMMICH_API_KEY ?? '';

export const GET: RequestHandler = async (event) => {
  const auth = await requireScope(event, 'read');
  const id = assertImmichId(event.params.id, 'asset');
  await requireAssetRead(event, auth, id);
  if (!IMMICH_BASE_URL) {
    throw error(500, 'IMMICH_BASE_URL not configured');
  }

  // Streamed straight to the caller below, so the budget covers the answer only.
  const res = await fetchWithAnswerDeadline(`${IMMICH_BASE_URL}/api/assets/${id}/thumbnail`, {
    headers: { 'x-api-key': IMMICH_API_KEY },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => res.statusText);
    return new Response(JSON.stringify({ error: `Upstream error: ${txt}` }), {
      status: res.status,
      headers: { 'content-type': 'application/json' },
    });
  }

  const headersOut = new Headers();
  const ct = res.headers.get('content-type') || 'application/octet-stream';
  headersOut.set('content-type', ct);
  const safe = ['etag', 'cache-control', 'expires', 'content-length'];
  for (const h of safe) {
    const v = res.headers.get(h);
    if (v) {
      headersOut.set(h, v);
    }
  }

  return new Response(res.body, { status: res.status, headers: headersOut });
};

export const DELETE: RequestHandler = async (event) => {
  const auth = await requireScope(event, 'write');
  const id = assertImmichId(event.params.id, 'asset');
  // A key holding `write` deletes, as before. A SESSION follows the one rule the proxy applies to a
  // deletion: staff, or the member who uploaded the photo.
  if (!auth.viaApiKey) {
    assertProxiedDeleteAllowed(auth, { ids: [id] });
  }
  if (!IMMICH_BASE_URL) {
    throw error(500, 'IMMICH_BASE_URL not configured');
  }

  const res = await fetch(`${IMMICH_BASE_URL}/api/assets/${id}`, {
    signal: AbortSignal.timeout(OUTBOUND_BUDGET_MS),
    method: 'DELETE',
    headers: { 'x-api-key': IMMICH_API_KEY },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => res.statusText);
    return new Response(JSON.stringify({ error: `Delete failed: ${txt}` }), {
      status: res.status,
      headers: { 'content-type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
