import type { PageServerLoad } from './$types';
import { requireAdminPage } from '$lib/server/auth';

/**
 * Nothing is loaded server-side on purpose: every figure on this page costs
 * upstream requests, and a slow Immich must not turn the page itself into an
 * error. The sections fetch what they need once mounted, each reporting its own
 * failure.
 */
export const load: PageServerLoad = ({ locals, cookies, url }) => {
  requireAdminPage({ locals, cookies }, url);

  return {};
};
