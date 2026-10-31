import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { requireScope } from '#lib/server/permissions.ts';
import { createLogger } from '#lib/server/logger.ts';
import { uploadOf } from '#lib/server/asset-uploads.ts';
import { IMMICH_ID } from '#lib/server/immich-proxy-allowlist.ts';
import { ImmichNotConfiguredError, requireImmichBaseUrl } from '#lib/immich/not-configured.ts';
import { env } from '#lib/server/env.ts';
import { OUTBOUND_BUDGET_MS } from '#lib/server/outbound.ts';

const log = createLogger('face-selfie-route');
const ASSET = new RegExp(`^${IMMICH_ID}$`);

/**
 * GET /api/users/me/face/selfie/[assetId] - the people Immich found on a selfie the member has
 * just uploaded, as ids only, for the settings page's linking flow. The Immich proxy no longer
 * hands an asset's people to a member (it would let anyone rebuild who appears in which photo), so
 * this answers for ONE asset: one the caller uploaded themselves as a new file (asset-uploads.ts).
 * A signed-in member only, never an API key.
 */
export const GET: RequestHandler = async (event) => {
  const auth = await requireScope(event, 'read');
  if (auth.viaApiKey || !auth.user) {
    throw error(403, 'A member session is required');
  }
  const assetId = (event.params.assetId ?? '').toLowerCase();
  if (!ASSET.test(assetId)) {
    throw error(400, 'Invalid asset id');
  }
  const upload = uploadOf(assetId, auth.user.id_user);
  if (!upload || upload.duplicate) {
    log.warn('selfie people refused: not a new upload of the caller');
    throw error(403, 'Not your upload');
  }
  let base: string;
  try {
    base = requireImmichBaseUrl().replace(/\/$/, '');
  } catch (e) {
    if (e instanceof ImmichNotConfiguredError) {
      throw error(503, e.message);
    }
    throw e;
  }
  const res = await event.fetch(`${base}/api/assets/${assetId}`, {
    signal: AbortSignal.timeout(OUTBOUND_BUDGET_MS),
    headers: { 'x-api-key': env.IMMICH_API_KEY ?? '', accept: 'application/json' },
  });
  if (!res.ok) {
    log.error('selfie people: Immich refused the asset read', { status: res.status });
    await res.body?.cancel().catch(() => undefined);
    throw error(502, 'Immich refused the asset read');
  }
  const asset = (await res.json()) as { people?: Array<{ id?: unknown }> };
  const people = (asset.people ?? [])
    .map((p) => p.id)
    .filter((id): id is string => typeof id === 'string')
    .map((id) => ({ id }));
  log.debug('selfie people read', { people: people.length });
  return json({ people });
};
