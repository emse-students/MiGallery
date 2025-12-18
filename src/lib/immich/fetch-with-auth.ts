/**
 * Helper pour les appels fetch à Immich avec gestion correcte des headers
 * TypeScript vérifie que la clé API est correctement typée
 */

export function createImmichHeaders(
	apiKey: string | undefined,
	additionalHeaders?: Record<string, string>
): Record<string, string> {
	const headers: Record<string, string> = {};

	if (apiKey) {
		headers['x-api-key'] = apiKey;
	}

	if (additionalHeaders) {
		Object.assign(headers, additionalHeaders);
	}

	return headers;
}
