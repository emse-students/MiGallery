import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getDatabase } from '#lib/db/database.ts';
import { getFaceDatabase } from '#lib/db/face-database.ts';
import { requireScope } from '#lib/server/permissions.ts';
import { isImpersonating } from '#lib/server/auth.ts';
import { createLogger } from '#lib/server/logger.ts';
import { holdsFace } from '#lib/server/face-photos.ts';
import { loadFaceBox } from '#lib/server/face-store.ts';
import { generateMemberFaceCrop } from '#lib/server/face-crop.ts';

const log = createLogger('face-crop-route');

/**
 * GET /api/users/me/face/crops/[assetId]/[faceIndex]
 * A square picture of ONE face given to the member (lot A6): what the confirmation screen shows.
 * Cut server-side from the box the face store holds, cached in the member's own directory, which a
 * withdrawal deletes (face-crop.ts).
 *
 * Served ONLY to the member who holds that face now - shown, or waiting for their answer. Anyone
 * else, an API key and an impersonated session get no picture: 404 when the face is not theirs
 * (the same answer whether it exists or not), 403 for an impersonation. `private, no-store`: a
 * face that leaves the member must not stay readable from a cache.
 */
export const GET: RequestHandler = async (event) => {
  const auth = await requireScope(event, 'read');
  if (isImpersonating(event)) {
    log.warn('face crop refused while impersonating');
    return json({ error: 'Not allowed while impersonating' }, { status: 403 });
  }
  const userId = auth.user?.id_user;
  if (!userId) {
    log.warn('face crop refused: no member (an API key holds no face)');
    return json({ error: 'Unauthorized - no user identified' }, { status: 401 });
  }
  const assetId = event.params.assetId ?? '';
  const faceIndex = Number(event.params.faceIndex);
  if (!/^[\w-]{1,64}$/.test(assetId) || !Number.isInteger(faceIndex) || faceIndex < 0) {
    return json({ error: 'Invalid face' }, { status: 400 });
  }
  const face = { assetId, faceIndex };

  const db = getDatabase();
  if (!holdsFace(db, userId, face)) {
    log.info('face crop refused: not a face the member holds');
    return json({ error: 'not_found' }, { status: 404 });
  }
  const box = loadFaceBox(getFaceDatabase(), face);
  if (!box) {
    log.warn('a held face has no box in the store');
    return json({ error: 'not_found' }, { status: 404 });
  }

  const crop = await generateMemberFaceCrop(userId, face, box, event.fetch, () =>
    holdsFace(db, userId, face)
  );
  if (crop.ok) {
    return new Response(new Uint8Array(crop.buffer), {
      headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'private, no-store' },
    });
  }
  if (crop.reason === 'busy') {
    return json({ error: 'busy' }, { status: 503, headers: { 'Retry-After': '2' } });
  }
  if (crop.reason === 'notfound') {
    return json({ error: 'not_found' }, { status: 404 });
  }
  return json({ error: 'Crop failed' }, { status: 500 });
};
