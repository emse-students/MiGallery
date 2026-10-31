import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { loginBounceTarget } from '#lib/auth-redirect.ts';

export const load: PageServerLoad = async ({ parent, url }) => {
  const { session } = await parent();
  const user = session?.user;

  // Anonymous: keep the path, the login comes back to it.
  if (!user) {
    throw redirect(303, loginBounceTarget(url.pathname + url.search));
  }

  // Another member's photos (`?userId=`): this page carries no photo itself, and every route it
  // reads them from enforces the owner's consent (src/lib/server/face-access.ts), so a viewer
  // needs no linked face of their own - the page shows "access denied" when the owner has not
  // authorised them.
  const target = url.searchParams.get('userId');
  if (target && target !== user.id_user) {
    return {};
  }

  // Their own photos without an identity photo: home, where the profile card says what to do.
  if (!user.photos_id) {
    throw redirect(303, '/');
  }

  return {};
};
