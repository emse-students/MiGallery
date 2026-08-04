import { redirect, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { clearSessionCookie, getSessionToken } from '$lib/session';
import { deleteSession } from '$lib/db/sessions';
import { createLogger } from '$lib/server/logger';

const log = createLogger('auth-logout');

/**
 * Log out: delete the session row, then the cookie.
 *
 * Deleting the row is what makes this real - the token stops being accepted
 * everywhere, immediately. Any impersonation dies with it, since it is a column
 * of that row rather than a cookie of its own.
 */
export const POST: RequestHandler = ({ cookies }) => {
	const token = getSessionToken(cookies);

	if (token) {
		try {
			deleteSession(token);
		} catch (e) {
			// The row is what makes the token dead. If it survives, the session is NOT
			// revoked - report that instead of a logout that did not happen.
			log.error('could not delete the session row', e);
			clearSessionCookie(cookies);
			throw error(500, 'Logout failed');
		}
	}

	clearSessionCookie(cookies);

	// Thrown OUTSIDE any try: a SvelteKit redirect is not an Error, so a catch
	// around it swallows the redirect and answers 500 on a logout that worked.
	throw redirect(302, '/');
};
