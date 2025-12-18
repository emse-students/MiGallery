import { getDatabase } from '$lib/db/database';
import { verifySigned } from '$lib/auth/cookies';
import type { SessionUser, UserRow } from '$lib/types/api';
import type { Cookies } from '@sveltejs/kit';

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
	if (fromCookie && (fromCookie.role || 'user') === 'admin') {
		return fromCookie;
	}

	if (!locals || typeof locals.auth !== 'function') {
		return null;
	}
	try {
		const session = await locals.auth();
		const providerUser = session?.user as SessionUser | null | undefined;
		if (!providerUser) {
			return null;
		}

		const candidateId =
			providerUser.id ||
			providerUser.preferred_username ||
			providerUser.sub ||
			(providerUser.email ? String(providerUser.email).split('@')[0] : undefined);
		if (!candidateId) {
			return null;
		}

		const db = getDatabase();
		let user = db.prepare('SELECT * FROM users WHERE id_user = ? LIMIT 1').get(candidateId) as
			| UserRow
			| undefined;
		if (!user && providerUser.email) {
			user = db.prepare('SELECT * FROM users WHERE email = ? LIMIT 1').get(providerUser.email) as
				| UserRow
				| undefined;
		}

		if (user && (user.role || 'user') === 'admin') {
			return user;
		}
		return null;
	} catch (_e) {
		void _e;
		return null;
	}
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

	if (!locals || typeof locals.auth !== 'function') {
		return null;
	}
	try {
		const session = await locals.auth();
		const providerUser = session?.user as SessionUser | null | undefined;
		if (!providerUser) {
			return null;
		}

		const candidateId =
			providerUser.id ||
			providerUser.preferred_username ||
			providerUser.sub ||
			(providerUser.email ? String(providerUser.email).split('@')[0] : undefined);
		if (!candidateId) {
			return null;
		}

		const db = getDatabase();
		let user = db.prepare('SELECT * FROM users WHERE id_user = ? LIMIT 1').get(candidateId) as
			| UserRow
			| undefined;
		if (!user && providerUser.email) {
			user = db.prepare('SELECT * FROM users WHERE email = ? LIMIT 1').get(providerUser.email) as
				| UserRow
				| undefined;
		}
		return user || null;
	} catch (_e) {
		void _e;
		return null;
	}
}
