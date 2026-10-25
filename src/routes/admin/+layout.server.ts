import type { LayoutServerLoad } from './$types';
import { requireAdminPage } from '#lib/server/auth.ts';

export const load: LayoutServerLoad = ({ locals, cookies, url }) => {
  requireAdminPage({ locals, cookies }, url);

  return {};
};
