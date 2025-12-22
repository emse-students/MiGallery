/**
 * Système centralisé de gestion des permissions pour l'API
 *
 * Hiérarchie des scopes:
 * - public: Aucune authentification requise
 * - read: Lecture seule (session OU x-api-key avec scope 'read')
 * - write: Lecture + écriture (session OU x-api-key avec scope 'write')
 * - admin: Accès administrateur (session admin OU x-api-key avec scope 'admin')
 *
 * Note: Le scope 'admin' sur une API key donne accès à TOUS les endpoints admin.
 */

import { error } from '@sveltejs/kit';
import { verifyRawKeyWithScope } from '$lib/db/api-keys';
import { getCurrentUser, ensureAdmin } from '$lib/server/auth';
import type { RequestEvent } from '@sveltejs/kit';
import type { UserRow } from '$lib/types/api';
import { logEvent } from '$lib/server/logs';

export type Scope = 'public' | 'read' | 'write' | 'admin';

export interface AuthResult {
	/** L'utilisateur authentifié (null si authentifié via API key) */
	user: UserRow | null;
	/** Le scope effectif accordé */
	grantedScope: Scope;
	/** True si authentifié via API key */
	viaApiKey: boolean;
}

/**
 * Vérifie que la requête a au moins le scope demandé.
 *
 * @param event - L'événement de requête SvelteKit
 * @param requiredScope - Le scope minimum requis
 * @param allowSelf - Si true, autorise l'utilisateur à accéder à ses propres ressources (pour GET/PUT sur /users/{id})
 * @param targetUserId - L'ID utilisateur cible (pour vérifier allowSelf)
 * @returns AuthResult contenant l'utilisateur et le scope accordé
 * @throws Error 401/403 si non autorisé
 */
export async function requireScope(
	event: RequestEvent,
	requiredScope: Scope,
	options?: {
		allowSelf?: boolean;
		targetUserId?: string;
	}
): Promise<AuthResult> {
	const { request, locals, cookies } = event;
	const { allowSelf = false, targetUserId } = options || {};

	if (requiredScope === 'public') {
		return {
			user: null,
			grantedScope: 'public',
			viaApiKey: false
		};
	}

	const apiKeyHeader = request.headers.get('x-api-key') || request.headers.get('X-API-KEY');
	if (apiKeyHeader) {
		if (requiredScope === 'admin') {
			if (!verifyRawKeyWithScope(apiKeyHeader, 'admin')) {
				throw error(403, 'Admin scope required');
			}
			return {
				user: null,
				grantedScope: 'admin',
				viaApiKey: true
			};
		}

		if (requiredScope === 'write') {
			if (
				!verifyRawKeyWithScope(apiKeyHeader, 'write') &&
				!verifyRawKeyWithScope(apiKeyHeader, 'admin')
			) {
				throw error(403, 'Write or Admin scope required');
			}
			return {
				user: null,
				grantedScope: verifyRawKeyWithScope(apiKeyHeader, 'admin') ? 'admin' : 'write',
				viaApiKey: true
			};
		}

		if (requiredScope === 'read') {
			if (
				!verifyRawKeyWithScope(apiKeyHeader, 'read') &&
				!verifyRawKeyWithScope(apiKeyHeader, 'write') &&
				!verifyRawKeyWithScope(apiKeyHeader, 'admin')
			) {
				throw error(403, 'Read, Write or Admin scope required');
			}
			const grantedScope = verifyRawKeyWithScope(apiKeyHeader, 'admin')
				? 'admin'
				: verifyRawKeyWithScope(apiKeyHeader, 'write')
					? 'write'
					: 'read';

			// Log API key usage (only for mutating methods or admin scope to avoid flooding)
			if (request.method !== 'GET' || grantedScope === 'admin') {
				void logEvent(event, 'api_usage', 'api_key', `${apiKeyHeader.slice(0, 8)  }...`, {
					method: request.method,
					path: event.url.pathname,
					scope: grantedScope
				});
			}

			return {
				user: null,
				grantedScope: grantedScope as Scope,
				viaApiKey: true
			};
		}
	}

	const user = await getCurrentUser({ locals, cookies });
	if (!user) {
		throw error(401, 'Authentication required');
	}

	if (requiredScope === 'admin') {
		const adminUser = await ensureAdmin({ locals, cookies });
		if (!adminUser) {
			throw error(403, 'Admin role required');
		}
		return {
			user: adminUser,
			grantedScope: 'admin',
			viaApiKey: false
		};
	}

	if (allowSelf && targetUserId && user.id_user === targetUserId) {
		return {
			user,
			grantedScope: 'write',
			viaApiKey: false
		};
	}

	return {
		user,
		grantedScope: requiredScope,
		viaApiKey: false
	};
}

/**
 * Version simplifiée pour les endpoints qui requièrent uniquement une session
 * (pas d'API key supportée)
 */
export async function requireSession(event: RequestEvent): Promise<UserRow> {
	const user = await getCurrentUser({ locals: event.locals, cookies: event.cookies });
	if (!user) {
		throw error(401, 'Session required');
	}
	return user;
}

/**
 * Version simplifiée pour les endpoints admin (session admin uniquement)
 */
export async function requireAdminSession(event: RequestEvent): Promise<UserRow> {
	const adminUser = await ensureAdmin({ locals: event.locals, cookies: event.cookies });
	if (!adminUser) {
		throw error(403, 'Admin session required');
	}
	return adminUser;
}
