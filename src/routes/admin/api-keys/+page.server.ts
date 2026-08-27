import type { PageServerLoad } from './$types';
import { requireAdminPage } from '$lib/server/auth';

export const load: PageServerLoad = ({ locals, cookies, url }) => {
  requireAdminPage({ locals, cookies }, url);

  return {};
};
