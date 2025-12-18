import { getDatabase } from '$lib/db/database';
import { signId } from '$lib/auth/cookies';
import { ensureAdmin } from '$lib/server/auth';
import type { RequestHandler } from './$types';

/**
 * Admin-only helper: set the signed `current_user_id` cookie to impersonate another user.
 * Usage: GET /admin/login-as?u=<user_id>
 * Requires: Current user must be admin
 */
export const GET: RequestHandler = async ({ url, cookies, locals }) => {
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

	const signed = signId(String(user.id_user));

	// Force delete first to ensure clean state
	cookies.delete('current_user_id', { path: '/' });

	cookies.set('current_user_id', signed, {
		httpOnly: true,
		secure: String(process.env.NODE_ENV) === 'production',
		sameSite: 'lax',
		path: '/',
		maxAge: 60 * 60 * 24 * 30 // 30 days
	});

	return new Response(
		`<html><head><meta http-equiv="refresh" content="1;url=/"></head><body>Redirecting...<script>
window.location.replace('/?t=' + Date.now());
window.addEventListener('pageshow', () => {
	if (window.location.search.startsWith('?t=')) {
		window.history.replaceState({}, '', '/');
	}
});
</script></body></html>`,
		{
			headers: {
				'Content-Type': 'text/html',
				'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
				Pragma: 'no-cache',
				Expires: '0'
			}
		}
	);
};
