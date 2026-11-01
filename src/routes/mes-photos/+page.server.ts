import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { loginBounceTarget } from '#lib/auth-redirect.ts';
import { getDatabase } from '#lib/db/database.ts';
import { faceStatus, type FaceStatus } from '#lib/server/face-photos.ts';

/**
 * "Mes photos" (lot A6): a member's own photos, or another member's when they were authorised.
 * For their own view the page gets their face status (counts only): whether to invite them to
 * enrol, and how many photos wait for their answer.
 */
export const load: PageServerLoad = async ({
  parent,
  url,
}): Promise<{ ownFace: FaceStatus | null }> => {
  const { session } = await parent();
  const user = session?.user;

  // Anonymous: keep the path, the login comes back to it.
  if (!user) {
    throw redirect(303, loginBounceTarget(url.pathname + url.search));
  }

  // Another member's photos (`?userId=`): this page carries no photo itself, and every route it
  // reads them from enforces the owner's consent (src/lib/server/face-access.ts), so a viewer
  // needs no face of their own - the page shows "access denied" when the owner has not
  // authorised them.
  const target = url.searchParams.get('userId');
  if (target && target !== user.id_user) {
    return { ownFace: null };
  }

  return { ownFace: faceStatus(getDatabase(), user.id_user) };
};
