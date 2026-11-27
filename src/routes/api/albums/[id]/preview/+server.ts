import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDatabase } from '#lib/db/database.ts';
import { assertImmichId } from '#lib/server/immich-id.ts';
import { requireViewerOfAlbum } from '#lib/server/album-asset-access.ts';
import { createLogger } from '#lib/server/logger.ts';

const log = createLogger('albums-id-preview');

/** What a link-preview card says about an album, and nothing more. */
export interface AlbumPreview {
  name: string;
  date: string | null;
  location: string | null;
  visibility: string;
}

/**
 * GET /api/albums/[id]/preview
 *
 * The card of an album as an unfurler draws it - name, date, place, visibility - for EVERY
 * visibility, private included. Read by Canari's link-preview service with its read-scoped key.
 *
 * It exists because `/info`, which Canari used to read, also returns the album's grant lists and
 * became the staff's in v2.23.1: a read key got a 403 and every album link in Canari lost its card.
 * The card needs none of those lists, so this route answers what it needs under the album READ
 * rule (`requireViewerOfAlbum`): a key with the `read` scope, or a session that may open the album.
 * Never the grant lists, never the photos. The covers it does not name are already public for every
 * album (`/cover`, `/og-cover`); `/og-preview` stays the anonymous variant, refusing private albums.
 *
 * @returns 200 with {@link AlbumPreview}; 400 for an id that is not an Immich id; 401 without a key
 *   or session; 403 for a key without a read scope or a member who may not open the album; 404 for
 *   an album the gallery does not know.
 */
export const GET: RequestHandler = async (event) => {
  const id = assertImmichId(event.params.id, 'album');
  await requireViewerOfAlbum(event, id);

  const row = getDatabase()
    .prepare('SELECT name, date, location, visibility FROM albums WHERE id = ?')
    .get(id) as
    | { name: string; date?: string | null; location?: string | null; visibility?: string | null }
    | undefined;

  if (!row) {
    // Reached by a key only: a session is answered 404 by `requireViewerOfAlbum` already.
    log.debug('album preview: unknown album', { albumId: id });
    throw error(404, 'Album not found');
  }

  const preview: AlbumPreview = {
    name: row.name,
    date: row.date || null,
    location: row.location || null,
    // The rule every reader applies: an album with no stated visibility is private.
    visibility: row.visibility || 'private',
  };
  log.debug('album preview served', { albumId: id, visibility: preview.visibility });
  return json(preview);
};
