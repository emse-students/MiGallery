import type { PageServerLoad } from './$types';
import { getDatabase } from '$lib/db/database';
import { getAlbumById, checkAlbumAccess } from '$lib/albums';
import type { User } from '$lib/types';
import { redirect } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ params, parent }) => {
  const paramId = params.id as string;
  if (!paramId) throw redirect(303, '/');

  const db = getDatabase();

  // Find album by id (which is the immich UUID in our schema)
  let albumRow: any = db.prepare('SELECT * FROM albums WHERE id = ? LIMIT 1').get(paramId);
  if (!albumRow) {
    // numeric fallback for very old DBs
    const num = Number(paramId);
    if (!isNaN(num)) albumRow = db.prepare('SELECT * FROM albums WHERE id = ? LIMIT 1').get(num);
  }

  if (!albumRow) throw redirect(303, '/albums');

  const album = { id: String(albumRow.id), name: albumRow.name, date: albumRow.date, location: albumRow.location, visibility: albumRow.visibility } as any;

  // If album is unlisted, allow access without authentication (anyone with the link)
  if ((album.visibility || '').toLowerCase() === 'unlisted') {
    return { album };
  }

  // Otherwise require authentication and authorization via session from parent layout
  const { session } = await parent();
  const user = session?.user as User | undefined;
  
  if (!user) {
    throw redirect(303, '/');
  }

  const allowed = checkAlbumAccess(user, album);
  if (!allowed) {
    throw redirect(303, '/');
  }

  return { album };
};
