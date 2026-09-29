/**
 * A signed avatar URL: the one way to fetch a person's avatar WITHOUT a session or an API key.
 *
 * WHY IT EXISTS. MinoWiki and Archives MINO show a MiGallery avatar, and they cannot hold a
 * session here: the URL reaches them inside each user's own OIDC claims, built by MiConnect. That
 * URL used to carry a `read` API key in its query string - and a MiGallery key is never scoped to
 * a route, so every user of either app received a key that reads every read-scoped API. A
 * signature over the user id opens exactly ONE thing, that user's avatar, and each person only
 * ever receives their own.
 *
 * WHAT IT IS. `sig = base64url(HMAC-SHA256(AVATAR_SIGNING_KEY, id_user))`, no padding. MiConnect
 * computes the same value in its `avatar` property mapping from the same key, which is the only
 * other holder of it. It never expires, deliberately: the claim is re-issued at every sign-in and
 * an expiring URL would break the avatar a relying party stored. Rotating the key invalidates
 * every URL at once, which is the revocation.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/** The signature MiConnect must put in `?sig=` for `idUser`'s avatar. */
export function computeAvatarSignature(key: string, idUser: string): string {
  return createHmac('sha256', key).update(idUser, 'utf8').digest('base64url');
}

/**
 * True when `sig` is the signature of `idUser` under `key`. Constant-time, and false for an empty
 * key, so a server started without the key refuses every signed URL instead of accepting a
 * signature anyone can compute.
 */
export function isAvatarSignatureValid(key: string, idUser: string, sig: string): boolean {
  if (!key) return false;
  const expected = Buffer.from(computeAvatarSignature(key, idUser), 'utf8');
  const given = Buffer.from(sig, 'utf8');
  return expected.length === given.length && timingSafeEqual(expected, given);
}
