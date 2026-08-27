import type { PageServerLoad } from './$types';
import { requireAdminPage } from '$lib/server/auth';

// Trash is admin-only: mitviste no longer has access (moved under /admin).
export const load: PageServerLoad = ({ locals, cookies, url }) => {
  requireAdminPage({ locals, cookies }, url);

  return {};
};
