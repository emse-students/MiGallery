import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { generateAuthorizationUrl } from '$lib/auth';
import { randomBytes } from 'crypto';

const STATE_COOKIE_NAME = '__oidc_state';
const NONCE_COOKIE_NAME = '__oidc_nonce';

function generateRandomString(length: number): string {
	return randomBytes(length).toString('base64url');
}

export const GET: RequestHandler = ({ cookies, url }) => {
	let authUrl: string;

	try {
		// Generate state and nonce
		const state = generateRandomString(32);
		const nonce = generateRandomString(32);

		// Store in cookies for validation on callback
		cookies.set(STATE_COOKIE_NAME, state, {
			path: '/',
			maxAge: 600, // 10 minutes
			sameSite: 'lax',
			secure: true,
			httpOnly: true
		});

		cookies.set(NONCE_COOKIE_NAME, nonce, {
			path: '/',
			maxAge: 600,
			sameSite: 'lax',
			secure: true,
			httpOnly: true
		});

		// Determine redirect URI
		const callbackUrl = new URL('/api/auth/callback', url.origin);
		authUrl = generateAuthorizationUrl(callbackUrl.toString(), state, nonce);
	} catch (e) {
		console.error('[LOGIN] Error:', e);
		throw error(500, 'Login failed');
	}

	throw redirect(302, authUrl);
};
