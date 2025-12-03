// Load .env at server startup (for production builds)
// IMPORTANT: This must run BEFORE importing auth.ts
import { config } from 'dotenv';
config({ override: true }); // Override existing vars to ensure .env takes precedence

import { sequence } from '@sveltejs/kit/hooks';
import type { Handle } from '@sveltejs/kit';
import { handle as authHandle } from '$lib/auth';

/**
 * Liste des domaines autorisés pour CORS.
 * '*' autorise toutes les origines (pour les API publiques avec x-api-key).
 */
const ALLOWED_ORIGINS = [
	'https://portail-etu.emse.fr',
	'https://gallery.mitv.fr',
	'http://localhost:5173',
	'http://localhost:3000'
];

/**
 * Routes API exemptées de la vérification CSRF de SvelteKit.
 * Ces routes utilisent une authentification par x-api-key, pas par cookies,
 * donc le risque CSRF est nul.
 */
const CSRF_EXEMPT_PATHS = ['/api/external/'];

/**
 * Vérifie si une route est exemptée de CSRF.
 */
function isCsrfExemptPath(pathname: string): boolean {
	return CSRF_EXEMPT_PATHS.some((path) => pathname.startsWith(path));
}

/**
 * Vérifie si l'origine est autorisée.
 */
function isAllowedOrigin(origin: string | null): boolean {
	if (!origin) {
		return true;
	} // Pas d'origin = requête serveur-à-serveur (curl, etc.)
	return ALLOWED_ORIGINS.includes(origin);
}

/**
 * Hook principal pour gérer CORS et contourner CSRF pour les routes API externes.
 *
 * STRATÉGIE :
 * 1. Pour les requêtes OPTIONS (preflight CORS) : répondre immédiatement avec les headers CORS.
 * 2. Pour les routes /api/external/* : réécrire l'en-tête Origin pour satisfaire la vérification
 *    CSRF native de SvelteKit (qui compare Origin avec l'URL du serveur).
 * 3. Ajouter les headers CORS à toutes les réponses des routes API.
 */
const corsAndCsrfHandler: Handle = async ({ event, resolve }) => {
	const { request, url } = event;
	const origin = request.headers.get('origin');
	const pathname = url.pathname;
	const isApiExternalRoute = isCsrfExemptPath(pathname);

	// ============================================
	// 1. Gestion des requêtes OPTIONS (preflight)
	// ============================================
	if (request.method === 'OPTIONS') {
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

	// ============================================
	// 2. Contournement CSRF pour /api/external/*
	// ============================================
	// SvelteKit vérifie que l'en-tête Origin correspond à url.origin.
	// Pour les routes API externes (authentifiées par x-api-key, pas cookies),
	// on réécrit l'en-tête Origin pour satisfaire cette vérification SI l'origine est autorisée.
	if (isApiExternalRoute && origin) {
		// Si l'origine est autorisée mais différente de url.origin, la réécrire
		if (isAllowedOrigin(origin) && origin !== url.origin) {
			const newHeaders = new Headers(request.headers);
			newHeaders.set('origin', url.origin);

			const modifiedRequest = new Request(request.url, {
				method: request.method,
				headers: newHeaders,
				body: request.body,
				// @ts-expect-error - duplex est nécessaire pour les requêtes avec body stream
				duplex: 'half'
			});

			// Remplacer la requête dans l'event
			Object.defineProperty(event, 'request', {
				value: modifiedRequest,
				writable: false
			});

			// @ts-expect-error - Ajout d'une propriété de debug
			event.locals.debugRewritten = true;
		} else if (origin !== url.origin) {
			// Si l'origine n'est PAS autorisée, on la réécrit quand même pour éviter l'erreur CSRF
			// mais on vérifierons l'autorisation après (dans la route handler)
			const newHeaders = new Headers(request.headers);
			newHeaders.set('origin', url.origin);

			const modifiedRequest = new Request(request.url, {
				method: request.method,
				headers: newHeaders,
				body: request.body,
				// @ts-expect-error - duplex est nécessaire pour les requêtes avec body stream
				duplex: 'half'
			});

			Object.defineProperty(event, 'request', {
				value: modifiedRequest,
				writable: false
			});

			// @ts-expect-error - Ajout d'une propriété de debug
			event.locals.debugRewritten = true;
		}
	}

	// ============================================
	// 3. Résoudre la requête normalement
	// ============================================
	const response = await resolve(event);

	// ============================================
	// 4. Ajouter les headers CORS aux réponses API
	// ============================================
	if (isApiExternalRoute || pathname.startsWith('/api/')) {
		const corsOrigin = isAllowedOrigin(origin) ? origin || '*' : 'null';
		response.headers.set('Access-Control-Allow-Origin', corsOrigin);
		response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
		response.headers.set(
			'Access-Control-Allow-Headers',
			'Content-Type, x-api-key, X-API-KEY, Authorization'
		);
		response.headers.set('Access-Control-Allow-Credentials', 'true');

		// DEBUG: Comprendre pourquoi le CSRF échoue
		response.headers.set('X-Debug-Request-Origin', origin || 'null');
		response.headers.set('X-Debug-Url-Origin', url.origin);
		response.headers.set('X-Debug-Is-Exempt', isApiExternalRoute.toString());
		// @ts-expect-error - Lecture de la propriété de debug
		if (event.locals.debugRewritten) {
			response.headers.set('X-Debug-Rewritten', 'true');
		}
	}

	return response;
};

export const handle = sequence(corsAndCsrfHandler, authHandle);
