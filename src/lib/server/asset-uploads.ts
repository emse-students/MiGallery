/**
 * Who uploaded an Immich asset. Every upload reaches Immich with the one shared key, so Immich
 * cannot say; the only record tying an asset to a member is the proxy's own audit row (`import`,
 * written by finishImmichUpload with the uploader as actor). Read by the
 * proxy's rule on deleting assets.
 */

import { getDatabase } from '#lib/db/database.ts';

/** The upload row of `assetId` by `userId`, or null when they did not upload it through MiGallery. */
export function uploadOf(assetId: string, userId: string): { duplicate: boolean } | null {
  const row = getDatabase()
    .prepare(
      "SELECT details FROM logs WHERE event_type = 'import' AND target_type = 'asset' AND target_id = ? AND actor = ? ORDER BY id DESC"
    )
    .get(assetId, userId) as { details: string | null } | null;
  if (!row) {
    return null;
  }
  const details = row.details ? (JSON.parse(row.details) as { duplicate?: boolean }) : {};
  return { duplicate: details.duplicate === true };
}

/**
 * Whether `userId` created every one of `assetIds` by their own upload (an empty list is not). A
 * DUPLICATE upload does not count: Immich answers it with the id of the asset that already
 * existed, which may be anyone's, so re-uploading a copy of a photo never makes it the uploader's.
 */
export function uploadedAllOf(assetIds: readonly string[], userId: string): boolean {
  return (
    assetIds.length > 0 &&
    assetIds.every((id) => {
      const upload = uploadOf(id, userId);
      return upload !== null && !upload.duplicate;
    })
  );
}
