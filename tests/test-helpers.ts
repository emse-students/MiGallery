/**
 * Configuration partagée pour tous les tests
 */

export const TEST_CONFIG = {
	API_BASE_URL: process.env.API_BASE_URL || 'http://localhost:3000',
	DEFAULT_TIMEOUT: 10000,
	LONG_TIMEOUT: 30000,
	IMMICH_TIMEOUT: 15000,

	// Configuration des scopes
	SCOPES: {
		READ: 'read',
		WRITE: 'write',
		DELETE: 'delete',
		ADMIN: 'admin'
	},

	// Configuration des rôles
	ROLES: {
		USER: 'user',
		ADMIN: 'admin',
		MODERATOR: 'moderator'
	},

	// Utilisateurs de test
	TEST_USERS: {
		SYSTEM: 'les.roots',
		PREFIX: 'test.user.'
	}
};

/**
 * Helper pour créer des headers d'authentification
 */
export function getAuthHeaders(apiKey?: string): Record<string, string> {
	const headers: Record<string, string> = {
		'Content-Type': 'application/json'
	};
	if (apiKey) {
		headers['x-api-key'] = apiKey;
	}
	return headers;
}

/**
 * Helper pour créer un utilisateur de test unique
 */
export function generateTestUser(prefix = 'test') {
	const timestamp = Date.now();
	return {
		id_user: `${prefix}.user.${timestamp}`,
		email: `${prefix}.${timestamp}@etu.emse.fr`,
		prenom: 'Test',
		nom: `User ${timestamp}`,
		role: 'user' as const,
		promo_year: 2025
	};
}

/**
 * Helper pour gérer les timeouts Immich
 */
export function handleImmichError(error: unknown): boolean {
	const err = error as { name?: string; code?: string };
	return err.name === 'TimeoutError' || err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT';
}

/**
 * Helper pour attendre qu'un service soit prêt
 */
export async function waitForService(
	url: string,
	maxRetries = 30,
	retryDelay = 1000
): Promise<boolean> {
	for (let i = 0; i < maxRetries; i++) {
		try {
			const response = await fetch(url);
			if (response.ok) {
				return true;
			}
		} catch {
			// Service pas encore prêt
		}
		await new Promise((resolve) => setTimeout(resolve, retryDelay));
	}
	return false;
}

/**
 * Helper pour nettoyer les ressources après les tests
 */
export async function cleanupResource(
	url: string,
	apiKey: string,
	resourceId: string | null
): Promise<void> {
	if (!resourceId) {
		return;
	}

	try {
		await fetch(`${url}/${resourceId}`, {
			method: 'DELETE',
			headers: { 'x-api-key': apiKey }
		});
	} catch {
		// Ignorer les erreurs de nettoyage
	}
}

/**
 * Types utiles pour les tests
 */
export interface TestContext {
	apiKey: string;
	readApiKey?: string;
	sessionCookie?: string;
	createdResources: {
		users: string[];
		albums: string[];
		apiKeys: string[];
	};
}

/**
 * Helper pour initialiser un contexte de test
 */
export function createTestContext(): TestContext {
	return {
		apiKey: '',
		createdResources: {
			users: [],
			albums: [],
			apiKeys: []
		}
	};
}

/**
 * Helper pour nettoyer un contexte de test complet
 */
export async function cleanupTestContext(context: TestContext): Promise<void> {
	const { API_BASE_URL } = TEST_CONFIG;

	// Nettoyer les utilisateurs
	for (const userId of context.createdResources.users) {
		await cleanupResource(`${API_BASE_URL}/api/users`, context.apiKey, userId);
	}

	// Nettoyer les albums
	for (const albumId of context.createdResources.albums) {
		await cleanupResource(`${API_BASE_URL}/api/albums`, context.apiKey, albumId);
	}

	// Nettoyer les clés API
	for (const keyId of context.createdResources.apiKeys) {
		await cleanupResource(`${API_BASE_URL}/api/admin/api-keys`, context.apiKey, keyId);
	}
}
