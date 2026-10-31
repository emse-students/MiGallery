import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { loginBounceTarget } from '#lib/auth-redirect.ts';

/**
 * The confirmation screen (lot A6): the photos where a face was given to the member with a doubt,
 * one yes or no each. The list and the pictures come from the API, served to the member alone.
 */
export const load: PageServerLoad = async ({ parent, url }) => {
  const { session } = await parent();
  if (!session?.user) {
    throw redirect(303, loginBounceTarget(url.pathname + url.search));
  }
  return {};
};
