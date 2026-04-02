import { getDatabase } from '$lib/db/database';
import { verifySigned } from '$lib/auth/cookies';
import type { UserRow } from '$lib/types/api';
import type { Cookies } from '@sveltejs/kit';

const SESSION_COOKIE_NAME = '__session_user';

/**
 * Try to resolve a local DB user from the signed cookie `current_user_id`.
 * Returns the DB row or null.
 */
export function getUserFromSignedCookie(cookies: Cookies): UserRow | null {
	try {
		const cookieSigned = cookies.get('current_user_id');
		if (!cookieSigned) {
			return null;
		}
		const verified = verifySigned(cookieSigned);
		if (!verified) {
			console.warn('[auth] current_user_id cookie failed verification');
			return null;
		}
		const db = getDatabase();
		const user = db.prepare('SELECT * FROM users WHERE id_user = ? LIMIT 1').get(verified) as
			| UserRow
			| undefined;
		if (!user) {
			console.warn('[auth] current_user_id cookie references unknown user', { id: verified });
			return null;
		}
		return user || null;
	} catch (e) {
		console.warn('[auth] error while resolving signed cookie', e);
		return null;
	}
}

/**
 * Try to resolve a local DB user from the plain session cookie `__session_user`.
 * Returns the DB row or null.
 */
export function getUserFromSessionCookie(cookies: Cookies): UserRow | null {
	try {
		const userId = cookies.get(SESSION_COOKIE_NAME);
		if (!userId) {
			return null;
		}

		const db = getDatabase();
		const user = db.prepare('SELECT * FROM users WHERE id_user = ? LIMIT 1').get(userId) as
			| UserRow
			| undefined;

		if (!user) {
			console.warn('[auth] __session_user cookie references unknown user', { id: userId });
			return null;
		}

		return user;
	} catch (e) {
		console.warn('[auth] error while resolving __session_user cookie', e);
		return null;
	}
}

function getUserFromLocals(locals: App.Locals): UserRow | null {
	try {
		const maybeUser = (locals as Record<string, unknown>)?.user as
			| { id?: string; id_user?: string }
			| null
			| undefined;

		const candidateId = maybeUser?.id_user || maybeUser?.id;
		if (!candidateId) {
			return null;
		}

		const db = getDatabase();
		const user = db.prepare('SELECT * FROM users WHERE id_user = ? LIMIT 1').get(candidateId) as
			| UserRow
			| undefined;
		return user || null;
	} catch {
		return null;
	}
}

/**
 * Ensure the caller is an admin. Uses cookie fast-path first, then provider fallback via locals.auth()
 * IMPORTANT: this helper DOES NOT create users automatically from provider identity — it only maps
 * provider identities to existing DB users. This avoids accidental privilege escalations.
 *
 * Returns the DB user row when admin or null otherwise.
 */
export async function ensureAdmin({
	locals,
	cookies
}: {
	locals: App.Locals;
	cookies: Cookies;
}): Promise<UserRow | null> {
	const fromCookie = getUserFromSignedCookie(cookies);
	// If a signed cookie exists, use it as the single source of truth.
	// Do NOT fall back to the provider identity when a cookie is present,
	// otherwise an admin who impersonates a non-admin would keep admin rights.
	if (fromCookie) {
		if ((fromCookie.role || 'user') === 'admin') {
			return fromCookie;
		}
		return null;
	}

	const fromSessionCookie = getUserFromSessionCookie(cookies);
	if (fromSessionCookie && (fromSessionCookie.role || 'user') === 'admin') {
		return fromSessionCookie;
	}

	const fromLocals = getUserFromLocals(locals);
	if (fromLocals && (fromLocals.role || 'user') === 'admin') {
		return fromLocals;
	}

	return null;
}

export async function getCurrentUser({
	locals,
	cookies
}: {
	locals: App.Locals;
	cookies: Cookies;
}): Promise<UserRow | null> {
	const cookieUser = getUserFromSignedCookie(cookies);
	if (cookieUser) {
		return cookieUser;
	}

	const sessionCookieUser = getUserFromSessionCookie(cookies);
	if (sessionCookieUser) {
		return sessionCookieUser;
	}

	return getUserFromLocals(locals);
}
