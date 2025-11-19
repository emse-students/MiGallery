import type { PageServerLoad } from './$types';
import { getAllAlbums } from '$lib/albums';

export const load: PageServerLoad = async () => {
  const albums = await getAllAlbums();
  return { albums };
};
