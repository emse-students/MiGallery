import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { loginBounceTarget } from '$lib/auth-redirect';

export const load: PageServerLoad = async ({ parent, url }) => {
  const { session } = await parent();
  const user = session?.user;

  if (!user) {
    throw redirect(303, loginBounceTarget(url.pathname + url.search));
  }

  return {};
};
