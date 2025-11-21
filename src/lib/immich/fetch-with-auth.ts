/**
 * Helper pour les appels fetch à Immich avec gestion correcte des headers
 * TypeScript vérifie que la clé API est correctement typée
 */

export function createImmichHeaders(
	apiKey: string | undefined,
	additionalHeaders?: Record<string, string>
): Record<string, string> {
	const headers: Record<string, string> = {};

	// Typage strict : si apiKey est undefined, on ne l'ajoute pas (ou on throw)
	if (apiKey) {
		headers['x-api-key'] = apiKey;
	}

	// Ajouter les headers supplémentaires
	if (additionalHeaders) {
		Object.assign(headers, additionalHeaders);
	}

	return headers;
}
