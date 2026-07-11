/**
 * Helper for fetch calls to Immich with correct header handling
 * TypeScript verifies that the API key is correctly typed
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
