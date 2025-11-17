import type { PageServerLoad } from './$types';
import { getDatabase } from '$lib/db/database';
import { redirect } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ parent }) => {
  // Use session from parent layout (respects signed cookie)
  const { session } = await parent();
  const user = session?.user as any;
  
  if (!user || user.role !== 'admin') {
    throw redirect(303, '/');
  }
  
  return {};
};
