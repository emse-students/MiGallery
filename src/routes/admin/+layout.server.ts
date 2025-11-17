import type { LayoutServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { ensureAdmin } from '$lib/server/auth';

export const load: LayoutServerLoad = async ({ locals, cookies }) => {
  const ok = await ensureAdmin({ locals, cookies });
  if (!ok) throw redirect(303, '/');
  return {};
};
