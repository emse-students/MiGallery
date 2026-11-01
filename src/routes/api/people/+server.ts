import { json, error, isHttpError } from '@sveltejs/kit';

import { ensureError } from '#lib/ts-utils.ts';
import type { RequestHandler } from './$types';
import { logEvent } from '#lib/server/logs.ts';
import {
  getAlbumAssets,
  getAlbumInfo,
  addAssetsToAlbum,
  removeAssetsFromAlbum,
} from '#lib/photos-cv/handlers.ts';
import { requireScope } from '#lib/server/permissions.ts';
import { assertPhotoCvManager, requirePhotoCvManager } from '#lib/server/face-access.ts';

import { createLogger } from '#lib/server/logger.ts';
import { ImmichNotConfiguredError } from '#lib/immich/not-configured.ts';

const log = createLogger('people');
/**
 * GET /api/people?action=...
 *
 * Actions (the PhotoCV album as a whole; managers and API keys):
 * - all-album-photos: ALL photos IN PhotoCV album
 * - album-info: Information about PhotoCV album
 *
 * The person-keyed actions `my-photos` and `album-photos` are gone with Immich's people (lot A6):
 * a member's photos are `GET /api/users/[userId]/photos-stream`.
 */
export const GET: RequestHandler = async (event) => {
  const { url, fetch } = event;
  const action = url.searchParams.get('action');

  // Each action names what it reads, so each is guarded by the rule for THAT (face-access.ts).
  const auth = await requireScope(event, 'read');

  try {
    switch (action) {
      case 'all-album-photos': {
        assertPhotoCvManager(auth, 'all-album-photos');
        const assets = await getAlbumAssets(fetch);
        return json({ assets });
      }

      case 'album-info': {
        assertPhotoCvManager(auth, 'album-info');
        const info = await getAlbumInfo(fetch);
        return json(info);
      }

      default:
        throw error(400, 'Invalid action. Valid actions: all-album-photos, album-info');
    }
  } catch (e: unknown) {
    if (isHttpError(e)) {
      throw e;
    }
    if (e instanceof ImmichNotConfiguredError) {
      throw error(503, e.message);
    }
    const err = ensureError(e);
    log.error('Error in /api/people GET:', err);
    throw error(500, err.message);
  }
};

/**
 * POST /api/people
 *
 * Actions:
 * - add-to-album: Add assets to PhotoCV album
 * - remove-from-album: Remove assets from PhotoCV album
 *
 * Body: { action: string, assetIds: string[] }
 */
export const POST: RequestHandler = async (event) => {
  await requirePhotoCvManager(event, 'write');
  try {
    const body = (await event.request.json()) as { action?: string; assetIds?: string[] };
    const { action, assetIds } = body;
    const { fetch } = event;

    if (!action || !assetIds || !Array.isArray(assetIds) || assetIds.length === 0) {
      throw error(400, 'action and assetIds[] are required');
    }

    switch (action) {
      case 'add-to-album': {
        const result = await addAssetsToAlbum(assetIds, fetch);
        void logEvent(event, 'update', 'album', 'PhotoCV', {
          action: 'add_assets',
          count: assetIds.length,
          assetIds,
        });
        return json({ success: true, added: result });
      }

      case 'remove-from-album': {
        const result = await removeAssetsFromAlbum(assetIds, fetch);
        void logEvent(event, 'update', 'album', 'PhotoCV', {
          action: 'remove_assets',
          count: assetIds.length,
          assetIds,
        });
        return json({ success: true, removed: result });
      }

      default:
        throw error(400, 'Invalid action. Valid actions: add-to-album, remove-from-album');
    }
  } catch (e: unknown) {
    if (isHttpError(e)) {
      throw e;
    }
    if (e instanceof ImmichNotConfiguredError) {
      throw error(503, e.message);
    }
    const err = ensureError(e);
    log.error('Error in /api/people POST:', err);
    throw error(500, err.message);
  }
};
