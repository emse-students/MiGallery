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
 *
 * REVOKING ONE USER'S LINK. Rotating the key is all-or-nothing, so each user also has an optional
 * SALT (table `avatar_revocations`). No salt (NULL, the state of every user until a revocation) signs
 * the bare id, exactly what MiConnect computes today. With a salt the signed message is
 * `<id_user>\n<salt>` (a newline between), so a revocation - a fresh random salt, {@link newAvatarSalt} - kills every
 * URL ever issued for that user and nobody else's. MiConnect cannot compute a salted signature,
 * so after a revocation that user's avatar stops showing in MinoWiki and Archives until the
 * mapping is taught the salt: revocation is a hard stop, and that is the point of it.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** The message that is signed: the bare id, or the id and the user's salt once one was set. */
function signedMessage(idUser: string, salt: string | null | undefined): string {
  return salt ? `${idUser}\n${salt}` : idUser;
}

/** A fresh salt for a revocation: 128 random bits, hex. */
export function newAvatarSalt(): string {
  return randomBytes(16).toString('hex');
}

/** The signature MiConnect must put in `?sig=` for `idUser`'s avatar (`salt`: see the file doc). */
export function computeAvatarSignature(key: string, idUser: string, salt?: string | null): string {
  return createHmac('sha256', key).update(signedMessage(idUser, salt), 'utf8').digest('base64url');
}

/**
 * True when `sig` is the signature of `idUser` under `key`. Constant-time, and false for an empty
 * key, so a server started without the key refuses every signed URL instead of accepting a
 * signature anyone can compute.
 */
export function isAvatarSignatureValid(
  key: string,
  idUser: string,
  sig: string,
  salt?: string | null
): boolean {
  if (!key) return false;
  const expected = Buffer.from(computeAvatarSignature(key, idUser, salt), 'utf8');
  const given = Buffer.from(sig, 'utf8');
  return expected.length === given.length && timingSafeEqual(expected, given);
}
