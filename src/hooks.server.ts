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
 * Hook principal pour gérer CORS et la sécurité CSRF.
 *
 * STRATÉGIE :
 * - La vérification CSRF native de SvelteKit est DÉSACTIVÉE (svelte.config.js).
 * - Ce hook implémente une vérification CSRF personnalisée :
 *   1. Routes /api/external/* : Exemptées (authentifiées par x-api-key, pas cookies).
 *   2. Autres routes avec mutation (POST, PUT, DELETE, PATCH) : Vérifier que l'Origin correspond.
 * - Gère aussi les réponses CORS pour toutes les routes API.
 */
const corsAndCsrfHandler: Handle = async ({ event, resolve }) => {
	const { request, url } = event;
	const origin = request.headers.get('origin');
	const pathname = url.pathname;
	const isApiExternalRoute = isCsrfExemptPath(pathname);
	const method = request.method;

	// ============================================
	// 1. Gestion des requêtes OPTIONS (preflight)
	// ============================================
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

	// ============================================
	// 2. Vérification CSRF pour les routes NON exemptées
	// ============================================
	// Pour les méthodes qui modifient des données, on vérifie que l'Origin correspond
	// (sauf pour les routes /api/external/* qui utilisent x-api-key)
	const isMutatingMethod = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method);

	if (isMutatingMethod && !isApiExternalRoute && origin) {
		// L'origine doit correspondre à l'URL du serveur OU être dans la liste des origines autorisées
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
	}

	return response;
};

export const handle = sequence(corsAndCsrfHandler, authHandle);
