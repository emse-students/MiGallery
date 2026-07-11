import { config } from 'dotenv';
config({ override: true }); // Override existing vars to ensure .env takes precedence

import { sequence } from '@sveltejs/kit/hooks';
import type { Handle } from '@sveltejs/kit';
import { getSessionUser } from '$lib/session';
import { startBackupScheduler } from '$lib/server/backup';
import { verifySigned } from '$lib/auth/cookies';
import { paraglideMiddleware } from '$lib/paraglide/server';

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
 * Hook to resolve the user session before the response is generated.
 * Also cleans up old legacy-format cookies (firstname.lastname) by deleting them.
 */
const sessionHandler: Handle = async ({ event, resolve }) => {
	const user = getSessionUser(event.cookies);
	event.locals.user = user ?? null;

	// Clean up old legacy-format cookies (containing dots = "firstname.lastname")
	// or invalid cookies (too short or malformed)
	const cookieSigned = event.cookies.get('current_user_id');
	if (cookieSigned) {
		// Verify the cookie can be decoded and has a valid format
		const decoded = verifySigned(cookieSigned);
		if (decoded) {
			// OIDC IDs are long UUIDs (64 hexadecimal characters or 36 standard UUID)
			// Old "firstname.lastname" formats are short (10-20 characters) and contain dots
			const isLegacyFormat =
				decoded.length < 32 || // UUID hex = 64 chars, too short means legacy
				(decoded.includes('.') && !decoded.includes('-')); // "firstname.lastname" format

			if (isLegacyFormat) {
				console.warn('🗑️  [Auth] Deleting legacy current_user_id cookie:', decoded);
				event.cookies.delete('current_user_id', { path: '/' });
			}
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
