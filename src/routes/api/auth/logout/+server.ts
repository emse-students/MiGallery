import { redirect, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { clearSessionCookie } from '$lib/session';
import { createLogger } from '$lib/server/logger';

const log = createLogger('auth-logout');

export const POST: RequestHandler = ({ cookies }) => {
	try {
		clearSessionCookie(cookies);
		// Also clear impersonation cookies: an orphaned `current_user_id` (set by
		// /admin/login-as) otherwise survives logout and locks admin access for ~30 days.
		cookies.delete('current_user_id', { path: '/' });
		cookies.delete('impersonator_admin_id', { path: '/' });

		throw redirect(302, '/');
	} catch (e) {
		if (e instanceof Error && e.message.includes('Redirect')) {
			throw e; // Re-throw redirect
		}
		log.error('logout failed', e);
		throw error(500, 'Logout failed');
	}
};
