import { canStopImpersonating } from '$lib/server/auth';
import { getSessionToken } from '$lib/session';
import { setSessionImpersonation } from '$lib/db/sessions';
import type { RequestHandler } from './$types';
import { redirect } from '@sveltejs/kit';

/**
 * End an impersonation started via /admin/login-as and restore the admin.
 *
 * This cannot be guarded by `ensureAdmin`, which judges the EFFECTIVE user and
 * therefore sees the impersonated one. It is guarded on the session's REAL
 * user instead - a fact the client cannot influence, which is precisely why the
 * impersonation had to live in the session row rather than in a cookie.
 */
export const GET: RequestHandler = ({ cookies, locals }) => {
	if (!canStopImpersonating({ locals, cookies })) {
		return new Response('Forbidden: no admin session to restore', { status: 403 });
	}

	const token = getSessionToken(cookies);
	if (token) {
		setSessionImpersonation(token, null);
	}

	throw redirect(303, '/admin');
};
