import { env } from '$env/dynamic/private';
import { createLogger } from '$lib/server/logger';
import { OUTBOUND_BUDGET_MS } from '$lib/server/outbound';

const log = createLogger('immich-trash');

const IMMICH_BASE_URL = env.IMMICH_BASE_URL;
const IMMICH_API_KEY = env.IMMICH_API_KEY ?? '';

/**
 * Pull asset ids back out of the Immich trash.
 *
 * WHY THIS EXISTS: re-uploading a file that Immich already knows is answered
 * with `{ status: 'duplicate', id }` and NOTHING ELSE - Immich hands back the
 * existing asset's id and, if that asset sits in the trash, leaves it there
 * (verified in the v3.1.0 `asset-media.service.ts` duplicate path). A trashed
 * asset is invisible everywhere in the gallery, so the import looked like it
 * had silently done nothing. Every path that imports a file or attaches an id
 * to an album therefore restores first.
 *
 * Restoring an id that is not trashed is a no-op upstream, so callers fire this
 * unconditionally rather than asking Immich about each asset first: one bulk
 * call instead of one GET per asset.
 *
 * NEVER THROWS. A failed restore must not sink the upload or the album-add that
 * asked for it - the worst case is the pre-existing behaviour.
 *
 * Returns how many assets Immich actually took out of the trash, so a caller
 * can tell "there was nothing to restore" from "a photo came back" - 0 for the
 * overwhelmingly common case where none of the ids were trashed.
 */
export async function restoreAssetsFromTrash(
  fetchFn: typeof fetch,
  ids: string[]
): Promise<number> {
  if (!Array.isArray(ids) || ids.length === 0) {
    return 0;
  }
  if (!IMMICH_BASE_URL) {
    return 0;
  }

  try {
    const res = await fetchFn(`${IMMICH_BASE_URL}/api/trash/restore/assets`, {
      signal: AbortSignal.timeout(OUTBOUND_BUDGET_MS),
      method: 'POST',
      headers: { 'x-api-key': IMMICH_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => res.statusText);
      log.warn(`trash restore failed (continuing): ${res.status} ${txt}`);
      return 0;
    }
    const data = (await res.json().catch(() => null)) as { count?: number } | null;
    return typeof data?.count === 'number' ? data.count : 0;
  } catch (e: unknown) {
    log.warn('trash restore failed (continuing):', e);
    return 0;
  }
}
