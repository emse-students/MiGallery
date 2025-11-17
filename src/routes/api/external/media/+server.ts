import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { getOrCreateSystemAlbum } from '$lib/immich/system-albums';
import { verifyRawKey } from '$lib/db/api-keys';

const IMMICH_BASE_URL = env.IMMICH_BASE_URL;
const IMMICH_API_KEY = env.IMMICH_API_KEY;

function checkExternalKey(provided?: string) {
  if (!provided) return false;
  try {
    return verifyRawKey(provided);
  } catch (e) {
    return false;
  }
}

/**
 * POST /api/external/media
 * - Upload multipart/form-data to Immich, add uploaded asset(s) to PortailEtu album
 * - Header: x-portal-api-key: <key>
 * Returns: { success: true, assetIds: string[] }
 */
export const POST: RequestHandler = async ({ request, fetch }) => {
  const providedKey = request.headers.get('x-portal-api-key') || undefined;
  if (!checkExternalKey(providedKey)) return json({ error: 'Unauthorized' }, { status: 401 });

  if (!IMMICH_BASE_URL) throw error(500, 'IMMICH_BASE_URL not configured');

  // Forward the multipart body to Immich upload endpoint
  const contentType = request.headers.get('content-type') || '';
  let body: BodyInit | undefined;
  try {
    if (contentType.includes('multipart/form-data')) {
      body = await request.arrayBuffer();
    } else {
      // accept raw body as text/json
      body = await request.text();
    }
  } catch (e) {
    console.error('Failed to read request body for external upload', e);
    throw error(400, 'Invalid request body');
  }

  const outgoingHeaders: Record<string, string> = {
    'x-api-key': IMMICH_API_KEY || '',
    accept: 'application/json'
  };
  if (contentType) outgoingHeaders['content-type'] = contentType;

  const uploadRes = await fetch(`${IMMICH_BASE_URL}/api/assets`, {
    method: 'POST',
    headers: outgoingHeaders,
    body: body as any
  });

  if (!uploadRes.ok) {
    const txt = await uploadRes.text().catch(() => uploadRes.statusText);
    console.error('Immich upload failed:', txt);
    throw error(uploadRes.status, `Upload failed: ${txt}`);
  }

  const uploadJson = await uploadRes.json().catch(() => null);
  // Try to extract asset ids from response
  let assetIds: string[] = [];
  if (Array.isArray(uploadJson)) {
    assetIds = uploadJson.map((it: any) => it.id).filter(Boolean);
  } else if (uploadJson?.assets && Array.isArray(uploadJson.assets)) {
    assetIds = uploadJson.assets.map((it: any) => it.id).filter(Boolean);
  } else if (uploadJson?.id) {
    assetIds = [uploadJson.id];
  }

  // If we couldn't parse ids, try to heuristically find them
  if (assetIds.length === 0 && uploadJson) {
    const maybeIds = Object.values(uploadJson).flat?.() || [];
    assetIds = (maybeIds || []).map((it: any) => it?.id).filter(Boolean);
  }

  // Add assets to PortailEtu album
  try {
    const albumId = await getOrCreateSystemAlbum(fetch, 'PortailEtu');
    if (assetIds.length > 0) {
      const res = await fetch(`${IMMICH_BASE_URL}/api/albums/${albumId}/assets`, {
        method: 'PUT',
        headers: { 'x-api-key': IMMICH_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: assetIds })
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => res.statusText);
        console.warn('Failed to add uploaded assets to PortailEtu:', txt);
      }
    }
  } catch (e) {
    console.warn('Failed to add assets to PortailEtu', e);
  }

  return json({ success: true, assetIds });
};

/**
 * GET /api/external/media
 * - List assets in PortailEtu album
 * - Header: x-portal-api-key
 */
export const GET: RequestHandler = async ({ fetch, request }) => {
  const providedKey = request.headers.get('x-portal-api-key') || undefined;
  if (!checkExternalKey(providedKey)) return json({ error: 'Unauthorized' }, { status: 401 });
  if (!IMMICH_BASE_URL) throw error(500, 'IMMICH_BASE_URL not configured');

  const albumId = await getOrCreateSystemAlbum(fetch, 'PortailEtu');
  const res = await fetch(`${IMMICH_BASE_URL}/api/albums/${albumId}`, { headers: { 'x-api-key': IMMICH_API_KEY, Accept: 'application/json' } });
  if (!res.ok) {
    const txt = await res.text().catch(() => res.statusText);
    throw error(res.status, `Failed to fetch album assets: ${txt}`);
  }
  const album = await res.json();
  const assets = album.assets || [];
  return json({ success: true, assets });
};
