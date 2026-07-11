import { getDatabase } from '$lib/db/database';
import { signId } from '$lib/auth/cookies';
import { ensureAdmin } from '$lib/server/auth';
import type { RequestHandler } from './$types';
import { redirect } from '@sveltejs/kit';

/**
 * Admin-only helper: set the signed `current_user_id` cookie to impersonate another user.
 * Usage: GET /admin/login-as?u=<user_id>
 * Requires: Current user must be admin
 */
export const GET: RequestHandler = async ({ url, cookies, locals }) => {
	// Verify the current user is admin
	const admin = await ensureAdmin({ locals, cookies });
	if (!admin) {
		return new Response('Forbidden: Admin access required', { status: 403 });
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

	const cookieOpts = {
		httpOnly: true,
		secure: String(process.env.NODE_ENV) === 'production',
		sameSite: 'lax' as const,
		path: '/',
		maxAge: 60 * 60 * 24 * 30 // 30 days
	};

	// Remember the original admin so they can return to their account (see
	// /admin/stop-impersonating). ensureAdmin already guaranteed the caller is
	// admin here, so this cookie can only be set by an admin.
	cookies.set('impersonator_admin_id', signId(String(admin.id_user)), cookieOpts);

	const signed = signId(String(user.id_user));
	cookies.set('current_user_id', signed, cookieOpts);

	// Redirect to home where the layout will pick up the new cookie
	throw redirect(303, '/');
};
