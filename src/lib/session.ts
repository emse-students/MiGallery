import { dev } from '$app/environment';
import type { Cookies } from '@sveltejs/kit';
import { getUserByCasId } from '$lib/db/users';
import { toSessionUser, type SessionUser } from '$lib/auth';

const SESSION_COOKIE_NAME = '__session_user';
const MAX_AGE = 365 * 24 * 60 * 60; // 1 year

/**
 * Set session cookie after successful login
 */
export function setSessionCookie(cookies: Cookies, userId: string): void {
	cookies.set(SESSION_COOKIE_NAME, userId, {
		path: '/',
		maxAge: MAX_AGE,
		sameSite: 'lax',
		secure: !dev,
		httpOnly: true
	});
}

/**
 * Clear session cookie on logout
 */
export function clearSessionCookie(cookies: Cookies): void {
	cookies.delete(SESSION_COOKIE_NAME, { path: '/' });
}

/**
 * Get current session user from cookie
 */
export function getSessionUser(cookies: Cookies): SessionUser | null {
	const userId = cookies.get(SESSION_COOKIE_NAME);

	if (!userId) {
		return null;
	}

	try {
		const dbUser = getUserByCasId(userId);
		if (!dbUser) {
			return null;
		}
		return toSessionUser(dbUser);
	} catch (e) {
		console.error('[SESSION] Error retrieving user:', e);
		return null;
	}
}
