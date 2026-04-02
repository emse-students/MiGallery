import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { completeOIDCFlow } from '$lib/auth';
import { setSessionCookie } from '$lib/session';

export const GET: RequestHandler = async ({ cookies, url }) => {
	console.log('[CALLBACK] OAuth callback received');
	const targetRedirect = '/';

	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');

	console.log('[CALLBACK] URL params:', {
		code: code ? `${code.substring(0, 20)}...` : 'missing',
		state
	});

	if (!code) {
		console.error('[CALLBACK] Missing authorization code');
		throw error(400, 'Missing authorization code');
	}

	if (!state) {
		console.error('[CALLBACK] Missing state parameter');
		throw error(400, 'Missing state parameter');
	}

	// Validate state
	const storedState = cookies.get('__oidc_state');
	if (state !== storedState) {
		console.error('[CALLBACK] State mismatch');
		throw error(400, 'State validation failed');
	}

	console.log('[CALLBACK] State validated ✓');

	try {
		// Complete OIDC flow
		const callbackUrl = new URL('/api/auth/callback', url.origin);
		const result = await completeOIDCFlow(code, callbackUrl.toString());

		if (!result) {
			console.error('[CALLBACK] OIDC flow failed');
			throw error(500, 'Authentication failed');
		}

		console.log('[CALLBACK] ✓ OIDC flow completed successfully');
		console.log('[CALLBACK] Setting session for user:', result.dbUser.id_user);

		// Set session cookie
		setSessionCookie(cookies, result.dbUser.id_user);

		console.log('[CALLBACK] ✓ Session cookie set, redirecting to home');

		// Clear OIDC cookies
		cookies.delete('__oidc_state', { path: '/' });
		cookies.delete('__oidc_nonce', { path: '/' });
	} catch (e) {
		console.error('[CALLBACK] Error during authentication:', e);
		throw error(500, 'Authentication error');
	}

	console.log('[CALLBACK] Redirecting to:', targetRedirect);
	throw redirect(302, targetRedirect);
};
