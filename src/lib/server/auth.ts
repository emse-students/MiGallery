import { getDatabase } from '$lib/db/database';
import { verifySigned } from '$lib/auth/cookies';

/**
 * Try to resolve a local DB user from the signed cookie `current_user_id`.
 * Returns the DB row or null.
 */
export function getUserFromSignedCookie(cookies: any) {
  const cookieSigned = cookies.get('current_user_id');
  if (!cookieSigned) return null;
  const verified = verifySigned(cookieSigned);
  if (!verified) return null;
  const db = getDatabase();
  const user = db.prepare('SELECT * FROM users WHERE id_user = ? LIMIT 1').get(verified) as any;
  return user || null;
}

/**
 * Ensure the caller is an admin. Uses cookie fast-path first, then provider fallback via locals.auth()
 * IMPORTANT: this helper DOES NOT create users automatically from provider identity — it only maps
 * provider identities to existing DB users. This avoids accidental privilege escalations.
 *
 * Returns the DB user row when admin or null otherwise.
 */
export async function ensureAdmin({ locals, cookies }: { locals: any; cookies: any }) {
  // cookie fast-path
  const fromCookie = getUserFromSignedCookie(cookies);
  if (fromCookie && (fromCookie.role || 'user') === 'admin') return fromCookie;

  // fallback to provider session but DO NOT auto-create users
  if (!locals || typeof locals.auth !== 'function') return null;
  try {
    const session = await locals.auth();
    const providerUser = session?.user as any | undefined;
    if (!providerUser) return null;

    // determine candidate provider id (same logic as +layout.server.ts)
    const candidateId = providerUser.id || providerUser.preferred_username || providerUser.sub || (providerUser.email ? String(providerUser.email).split('@')[0] : undefined);
    if (!candidateId) return null;

    const db = getDatabase();
    let user = db.prepare('SELECT * FROM users WHERE id_user = ? LIMIT 1').get(candidateId) as any;
    if (!user && providerUser.email) {
      user = db.prepare('SELECT * FROM users WHERE email = ? LIMIT 1').get(providerUser.email) as any;
    }

    if (user && (user.role || 'user') === 'admin') return user;
    return null;
  } catch (e) {
    return null;
  }
}

export async function getCurrentUser({ locals, cookies }: { locals: any; cookies: any }) {
  // Try cookie first
  const cookieUser = getUserFromSignedCookie(cookies);
  if (cookieUser) return cookieUser;

  // Fallback to provider mapping (do not create new users)
  if (!locals || typeof locals.auth !== 'function') return null;
  try {
    const session = await locals.auth();
    const providerUser = session?.user as any | undefined;
    if (!providerUser) return null;

    const candidateId = providerUser.id || providerUser.preferred_username || providerUser.sub || (providerUser.email ? String(providerUser.email).split('@')[0] : undefined);
    if (!candidateId) return null;

    const db = getDatabase();
    let user = db.prepare('SELECT * FROM users WHERE id_user = ? LIMIT 1').get(candidateId) as any;
    if (!user && providerUser.email) {
      user = db.prepare('SELECT * FROM users WHERE email = ? LIMIT 1').get(providerUser.email) as any;
    }
    return user || null;
  } catch (e) {
    return null;
  }
}
