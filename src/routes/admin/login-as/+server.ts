import { getDatabase } from '$lib/db/database';
import { ensureAdmin } from '$lib/server/auth';
import { getSessionToken } from '$lib/session';
import { setSessionImpersonation } from '$lib/db/sessions';
import type { RequestHandler } from './$types';
import { redirect } from '@sveltejs/kit';

/**
 * Admin-only helper: act as another user.
 * Usage: GET /admin/login-as?u=<user_id>
 *
 * The impersonation is recorded ON THE CALLER'S SESSION, not in a cookie of its
 * own, so it cannot outlive the session that authorised it and the real admin
 * behind it stays known.
 */
export const GET: RequestHandler = async ({ url, cookies, locals }) => {
	// Verify the current user is admin
	const admin = await ensureAdmin({ locals, cookies });
	if (!admin) {
		return new Response('Forbidden: Admin access required', { status: 403 });
	}

	const token = getSessionToken(cookies);
	if (!token) {
		return new Response('Forbidden: no session to impersonate through', { status: 403 });
	}

	const username = url.searchParams.get('u');
	if (!username) {
		return new Response('Missing parameter: u (username)', { status: 400 });
	}

	const db = getDatabase();
	const user = db.prepare('SELECT * FROM users WHERE id_user = ? LIMIT 1').get(username) as
		| { id_user: string }
		| undefined;

	if (!user) {
		return new Response(`User ${username} not found in database.`, { status: 404 });
	}

	setSessionImpersonation(token, String(user.id_user));

	// Redirect to home where the layout will pick up the new effective user
	throw redirect(303, '/');
};
