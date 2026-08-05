/**
 * Where a login comes back to.
 *
 * An anonymous visitor who opens a gated URL (an album link someone shared) is
 * bounced to the home page, which is also the sign-in screen. Without the path
 * travelling with them, signing in lands them on the home page instead of the
 * album they were sent. The path rides as `?redirectTo=` on `/`, then on
 * `/api/auth/login`, which parks it in a short-lived cookie for the Authentik
 * round trip (`src/routes/api/auth/{login,callback}`).
 *
 * Everything the browser hands back is attacker-controlled, so both ends of
 * that trip validate through `safeRedirectTarget` - the write side alone would
 * leave the cookie itself as an unchecked input.
 */

/** The `/` query parameter carrying the post-login destination. */
export const REDIRECT_PARAM = 'redirectTo';

/** The cookie that carries it across the Authentik round trip. */
export const RETURN_COOKIE_NAME = '__oidc_return';

/** Control characters, which have no place in a `Location` value. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/**
 * The value as an in-app destination, or null when it cannot be one.
 *
 * Rejects, in order: an absolute URL, a protocol-relative one (`//evil.com` and
 * `/\evil.com` both start with `/` yet leave the site), control characters, the
 * home page (nothing to remember) and the auth routes themselves (a loop).
 */
export function safeRedirectTarget(raw: string | null | undefined): string | null {
	if (!raw || typeof raw !== 'string') {
		return null;
	}

	if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) {
		return null;
	}

	if (CONTROL_CHARACTERS.test(raw)) {
		return null;
	}

	if (raw === '/' || raw.startsWith('/api/auth/')) {
		return null;
	}

	return raw;
}

/**
 * The home page, carrying `pathWithQuery` when it is worth returning to.
 *
 * This is what a guard redirects an ANONYMOUS visitor to. A logged-in visitor
 * refused for lack of rights gets a plain `/`: handing them a destination would
 * only bounce them back into the same refusal.
 */
export function loginBounceTarget(pathWithQuery: string | null | undefined): string {
	const target = safeRedirectTarget(pathWithQuery);

	return target ? `/?${REDIRECT_PARAM}=${encodeURIComponent(target)}` : '/';
}

/** The login route, carrying the destination the browser asked to come back to. */
export function loginUrlWithRedirect(rawTarget: string | null | undefined): string {
	const target = safeRedirectTarget(rawTarget);

	return target
		? `/api/auth/login?${REDIRECT_PARAM}=${encodeURIComponent(target)}`
		: '/api/auth/login';
}
