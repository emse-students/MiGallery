import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { completeOIDCFlow } from '$lib/auth';
import { setSessionCookie } from '$lib/session';

import { createLogger } from '$lib/server/logger';

const log = createLogger('auth-callback');
export const GET: RequestHandler = async ({ cookies, url }) => {
	const targetRedirect = '/';

	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');

	if (!code) {
		log.error('Missing authorization code');
		throw error(400, 'Missing authorization code');
	}

	if (!state) {
		log.error('Missing state parameter');
		throw error(400, 'Missing state parameter');
	}

	// Validate state
	const storedState = cookies.get('__oidc_state');
	if (state !== storedState) {
		log.error('State mismatch');
		throw error(400, 'State validation failed');
	}

	try {
		// Complete OIDC flow
		const callbackUrl = new URL('/api/auth/callback', url.origin);
		const result = await completeOIDCFlow(code, callbackUrl.toString());

		if (!result) {
			log.error('OIDC flow failed');
			throw error(500, 'Authentication failed');
		}

		// Set session cookie
		setSessionCookie(cookies, result.dbUser.id_user);

		// Clear OIDC cookies
		cookies.delete('__oidc_state', { path: '/' });
		cookies.delete('__oidc_nonce', { path: '/' });
	} catch (e) {
		log.error('Error during authentication:', e);
		throw error(500, 'Authentication error');
	}

	throw redirect(302, targetRedirect);
};
