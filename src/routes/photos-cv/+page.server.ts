import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { loginBounceTarget } from '#lib/auth-redirect.ts';

export const load: PageServerLoad = async ({ parent, url }) => {
  const { session } = await parent();
  const user = session?.user;

  if (!user) {
    throw redirect(303, loginBounceTarget(url.pathname + url.search));
  }

  // Without face matching a member has no CV photo of their own: /mes-photos says how to start.
  const canManagePhotos = user.role === 'admin' || user.role === 'mitviste';
  if (!user.face_enrolled && !canManagePhotos) {
    throw redirect(303, '/mes-photos');
  }

  return {};
};
