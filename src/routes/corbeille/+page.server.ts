import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ parent }) => {
  // Corbeille accessible uniquement aux admins et mitvistes
  const { session } = await parent();
  const user = session?.user as any;
  
  if (!user) {
    throw redirect(303, '/');
  }
  
  const canManagePhotos = user.role === 'admin' || user.role === 'mitviste';
  if (!canManagePhotos) {
    throw redirect(303, '/');
  }
  
  return {};
};
