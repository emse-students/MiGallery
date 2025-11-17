import type { PageServerLoad } from './$types';
import { getDatabase } from '$lib/db/database';
import { listAllAlbums, checkAlbumAccess } from '$lib/albums';
import type { User } from '$lib/types';
import { redirect } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ parent }) => {
  // Use session from parent layout (respects signed cookie)
  const { session } = await parent();
  const user = session?.user as User | undefined;
  
  if (!user) {
    throw redirect(303, '/');
  }

  const albums = listAllAlbums();
  const allowed = albums.filter(a => checkAlbumAccess(user, a));

  return { albums: allowed };
};
