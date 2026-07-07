import { getDatabase } from '$lib/db/database';
import { verifySigned } from '$lib/auth/cookies';
import { getUserFromSessionCookie } from '$lib/server/auth';
import type { RequestHandler } from './$types';
import { redirect } from '@sveltejs/kit';

/**
 * End an impersonation started via /admin/login-as and restore the original admin.
 *
 * This CANNOT be guarded by `ensureAdmin`: during impersonation the
 * `current_user_id` cookie makes the caller look like a non-admin. We instead
 * validate the original admin via two independent signals:
 *  - `__session_user`: the real session (login-as never touches it), or
 *  - `impersonator_admin_id`: signed cookie set by login-as.
 * If either points to an admin, we clear the impersonation cookies.
 */
export const GET: RequestHandler = ({ cookies }) => {
	const isAdminId = (id: string | null | undefined): boolean => {
		if (!id) {
			return false;
		}
		const db = getDatabase();
		const row = db.prepare('SELECT role FROM users WHERE id_user = ? LIMIT 1').get(id) as
			| { role?: string }
			| undefined;
		return (row?.role || 'user') === 'admin';
	};

	const sessionUser = getUserFromSessionCookie(cookies);
	const originalAdminId = verifySigned(cookies.get('impersonator_admin_id') || '');

	const allowed =
		(sessionUser && (sessionUser.role || 'user') === 'admin') || isAdminId(originalAdminId);

	if (!allowed) {
		return new Response('Forbidden: no admin session to restore', { status: 403 });
	}

	cookies.delete('current_user_id', { path: '/' });
	cookies.delete('impersonator_admin_id', { path: '/' });

	throw redirect(303, '/admin');
};
