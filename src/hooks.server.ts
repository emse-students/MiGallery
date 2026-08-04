import { config } from 'dotenv';
config({ override: true }); // Override existing vars to ensure .env takes precedence

import { sequence } from '@sveltejs/kit/hooks';
import type { Handle } from '@sveltejs/kit';
import {
	getSessionUser,
	LEGACY_IMPERSONATION_COOKIES,
	LEGACY_SESSION_COOKIE_NAME
} from '$lib/session';
import { startBackupScheduler } from '$lib/server/backup';
import { paraglideMiddleware } from '$lib/paraglide/server';
import { cookieName as LOCALE_COOKIE, isLocale } from '$lib/paraglide/runtime';

// Start the daily automatic backup as soon as the server starts
startBackupScheduler();

/**
 * List of allowed domains for CORS.
 * '*' allows all origins (for public APIs with x-api-key).
 */
const ALLOWED_ORIGINS = [
	'https://portail-etu.emse.fr',
	'https://gallery.mitv.fr',
	'https://canari-emse.fr',
	'http://localhost:5173',
	'http://localhost:5174',
	'http://localhost:3000'
];

/**
 * API routes exempt from SvelteKit's CSRF check.
 * These routes use x-api-key authentication, not cookies,
 * so the CSRF risk is nil.
 */
const CSRF_EXEMPT_PATHS = ['/api/external/', '/api/auth/'];

/**
 * Checks whether a route is exempt from CSRF.
 */
function isCsrfExemptPath(pathname: string): boolean {
	return CSRF_EXEMPT_PATHS.some((path) => pathname.startsWith(path));
}

/**
 * Checks whether the origin is allowed.
 */
function isAllowedOrigin(origin: string | null): boolean {
	if (!origin) {
		return true;
	}
	return ALLOWED_ORIGINS.includes(origin);
}

/**
 * Main hook to handle CORS and CSRF security.
 *
 * STRATEGY:
 * - SvelteKit's native CSRF check is DISABLED (svelte.config.js).
 * - This hook implements a custom CSRF check:
 *   1. /api/external/* routes: Exempt (authenticated by x-api-key, not cookies).
 *   2. Other mutating routes (POST, PUT, DELETE, PATCH): Verify the Origin matches.
 * - Also handles CORS responses for all API routes.
 */
const corsAndCsrfHandler: Handle = async ({ event, resolve }) => {
	const { request, url } = event;
	const origin = request.headers.get('origin');
	const pathname = url.pathname;
	const isApiExternalRoute = isCsrfExemptPath(pathname);
	const method = request.method;

	if (method === 'OPTIONS') {
		const corsOrigin = isAllowedOrigin(origin) ? origin || '*' : 'null';
		return new Response(null, {
			status: 204,
			headers: {
				'Access-Control-Allow-Origin': corsOrigin,
				'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
				'Access-Control-Allow-Headers': 'Content-Type, x-api-key, X-API-KEY, Authorization',
				'Access-Control-Allow-Credentials': 'true',
				'Access-Control-Max-Age': '86400'
			}
		});
	}

	const isMutatingMethod = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method);

	if (isMutatingMethod && !isApiExternalRoute && origin) {
		const originAllowed = origin === url.origin || isAllowedOrigin(origin);
		if (!originAllowed) {
			return new Response('Cross-site POST form submissions are forbidden', {
				status: 403,
				headers: {
					'Content-Type': 'text/plain'
				}
			});
		}
	}

	const response = await resolve(event);

	if (/\.(png|jpg|jpeg|gif|webp|svg|woff|woff2|ttf|eot)$/i.test(pathname)) {
		response.headers.set('Cache-Control', 'public, max-age=172800, immutable');
	} else if (/\/_app\//.test(pathname)) {
		response.headers.set('Cache-Control', 'public, max-age=172800, immutable');
	} else if (pathname === '/' || /\.html$/.test(pathname)) {
		response.headers.set('Cache-Control', 'public, max-age=0, must-revalidate');
	} else if (!pathname.startsWith('/api/')) {
		response.headers.set('Cache-Control', 'public, max-age=0, must-revalidate');
	}

	if (isApiExternalRoute || pathname.startsWith('/api/')) {
		const corsOrigin = isAllowedOrigin(origin) ? origin || '*' : 'null';
		response.headers.set('Access-Control-Allow-Origin', corsOrigin);
		response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
		response.headers.set(
			'Access-Control-Allow-Headers',
			'Content-Type, x-api-key, X-API-KEY, Authorization'
		);
		response.headers.set('Access-Control-Allow-Credentials', 'true');
	}

	return response;
};

/**
 * Resolve the session before the response is generated, and delete the cookies
 * of the mechanisms this replaced.
 *
 * Those cookies are not merely obsolete: `__session_user` used to hold a RAW
 * user id that nothing verified, so a browser still holding one is holding a
 * forgeable credential. They are cleared on sight rather than left to expire.
 */
const sessionHandler: Handle = async ({ event, resolve }) => {
	const user = getSessionUser(event.cookies);
	event.locals.user = user ?? null;

	// Seed the Paraglide locale cookie from the user's saved preference the first
	// time they land in a browser that has no cookie yet (e.g. a new device). This
	// lets the chosen language follow the account. We only seed when the cookie is
	// absent, so a local switch on this browser is never reverted.
	if (user?.locale && isLocale(user.locale) && !event.cookies.get(LOCALE_COOKIE)) {
		event.cookies.set(LOCALE_COOKIE, user.locale, {
			path: '/',
			maxAge: 60 * 60 * 24 * 365,
			sameSite: 'lax'
		});
	}

	for (const name of [LEGACY_SESSION_COOKIE_NAME, ...LEGACY_IMPERSONATION_COOKIES]) {
		if (event.cookies.get(name) !== undefined) {
			event.cookies.delete(name, { path: '/' });
		}
	}

	return resolve(event);
};

/**
 * Binds the request locale (resolved from the paraglide cookie / Accept-Language
 * header, falling back to the base locale fr) to the server-side async context so
 * that `m.*()` renders in the right language during SSR, and injects it into the
 * <html lang> tag.
 *
 * Skipped for /api/* routes: they return JSON, never localized HTML, and the
 * middleware rebuilds event.request - which drops the body of raw-blob requests
 * (chunked uploads) under adapter-node. API routes must keep the original request.
 */
const paraglideHandler: Handle = ({ event, resolve }) => {
	if (event.url.pathname.startsWith('/api/')) {
		return resolve(event);
	}
	return paraglideMiddleware(event.request, ({ request, locale }) => {
		event.request = request;
		return resolve(event, {
			transformPageChunk: ({ html }) => html.replace('%paraglide.lang%', locale)
		});
	});
};

export const handle = sequence(paraglideHandler, corsAndCsrfHandler, sessionHandler);
