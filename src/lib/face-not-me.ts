/**
 * "Ce n'est pas moi" on a photo of the member's own "Mes photos" (owner, 2026-11-01): one question,
 * then `POST /api/users/me/face/rejections`, which takes every face of theirs on the photo away
 * from them as a "Pas moi" does. No undo toast: the way back is Paramètres → "Photos écartées".
 */

import { showConfirm } from '#lib/confirm.ts';
import { toast } from '#lib/toast.ts';
import { m } from '#lib/paraglide/messages.js';

/**
 * Ask the member, then remove `assetId` from their photos. Resolves `true` once the server took it
 * away (or it was not theirs any more, 404: it is gone from their photos either way), `false` when
 * they cancelled or the removal failed (an error toast says so).
 */
export async function removeFromMyPhotos(assetId: string): Promise<boolean> {
  const ok = await showConfirm(
    m.mp_not_me_confirm_body(),
    m.mp_not_me_confirm_title(),
    m.mp_not_me_confirm_action()
  );
  if (!ok) {
    return false;
  }
  try {
    const res = await fetch('/api/users/me/face/rejections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ asset_id: assetId }),
    });
    if (res.ok || res.status === 404) {
      console.debug('[not-me] photo removed', { status: res.status });
      return true;
    }
    console.warn('[not-me] the removal was refused', res.status);
  } catch (e) {
    console.warn('[not-me] the removal could not be sent', e);
  }
  toast.error(m.mp_not_me_error());
  return false;
}
