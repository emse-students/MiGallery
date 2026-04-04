import { config } from 'dotenv';
config({ override: true }); // Override existing vars to ensure .env takes precedence

import { sequence } from '@sveltejs/kit/hooks';
import type { Handle } from '@sveltejs/kit';
import { getSessionUser } from '$lib/session';
import { startBackupScheduler } from '$lib/server/backup';
import { verifySigned } from '$lib/auth/cookies';

// Démarre la sauvegarde automatique quotidienne dès le démarrage du serveur
startBackupScheduler();

/**
 * Liste des domaines autorisés pour CORS.
 * '*' autorise toutes les origines (pour les API publiques avec x-api-key).
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
 * Routes API exemptées de la vérification CSRF de SvelteKit.
 * Ces routes utilisent une authentification par x-api-key, pas par cookies,
 * donc le risque CSRF est nul.
 */
const CSRF_EXEMPT_PATHS = ['/api/external/', '/api/auth/'];

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
	}
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
 * Hook pour résoudre la session utilisateur avant que la réponse ne soit générée.
 * Nettoie aussi les vieux cookies au format legacy (prenom.nom) en les supprimant.
 */
const sessionHandler: Handle = async ({ event, resolve }) => {
	const user = getSessionUser(event.cookies);
	event.locals.user = user ?? null;

	// Nettoyer les vieux cookies au format legacy (contenant des points = "prenom.nom")
	// ou cookies non-valides (format trop court ou mal formé)
	const cookieSigned = event.cookies.get('current_user_id');
	if (cookieSigned) {
		// Vérifier que le cookie peut être décodé et a un format valide
		const decoded = verifySigned(cookieSigned);
		if (decoded) {
			// Les IDs OIDC sont des UUID longs (64 caractères hexadécimaux ou 36 UUID standard)
			// Les vieux formats "prenom.nom" sont court (10-20 caractères) et contiennent des points
			const isLegacyFormat =
				decoded.length < 32 || // UUID hex = 64 chars, trop court c'est legacy
				(decoded.includes('.') && !decoded.includes('-')); // Format "prenom.nom"

			if (isLegacyFormat) {
				console.warn('🗑️  [Auth] Suppression du cookie legacy current_user_id:', decoded);
				event.cookies.delete('current_user_id', { path: '/' });
			}
		}
	}

	return resolve(event);
};

export const handle = sequence(corsAndCsrfHandler, sessionHandler);
