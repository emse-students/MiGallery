import { redirect, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { clearSessionCookie } from '$lib/session';

export const POST: RequestHandler = async ({ cookies }) => {
	console.log('[LOGOUT] Logout requested');

	try {
		clearSessionCookie(cookies);
		console.log('[LOGOUT] ✓ Session cleared, redirecting to home');

		throw redirect(302, '/');
	} catch (e) {
		if (e instanceof Error && e.message.includes('Redirect')) {
			throw e; // Re-throw redirect
		}
		console.error('[LOGOUT] Error:', e);
		throw error(500, 'Logout failed');
	}
};
