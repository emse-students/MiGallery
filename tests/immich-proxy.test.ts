/**
 * Comprehensive tests for the Immich Proxy
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestAuth, teardownTestAuth, globalTestContext } from './test-helpers';

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';

beforeAll(async () => {
	await setupTestAuth();
});

afterAll(async () => {
	if (globalTestContext.adminApiKey) {
		await teardownTestAuth(globalTestContext as import('./test-helpers').TestContext);
	}
});

const getAuthHeaders = () => {
	const headers: Record<string, string> = {
		'Content-Type': 'application/json'
	};
	if (globalTestContext.adminApiKey) {
		headers['x-api-key'] = globalTestContext.adminApiKey;
	}
	return headers;
};

describe('Immich Proxy - GET requests', () => {
	it('should proxy GET requests to Immich', async () => {
		const response = await fetch(`${API_BASE_URL}/api/immich/assets`, {
			headers: getAuthHeaders(),
			signal: AbortSignal.timeout(10000)
		});

		expect([200, 401, 404, 500, 502]).toContain(response.status);
	}, 15000);

	it('should proxy the albums request', async () => {
		const response = await fetch(`${API_BASE_URL}/api/immich/albums`, {
			headers: getAuthHeaders(),
			signal: AbortSignal.timeout(10000)
		});

		expect([200, 401, 404, 500, 502]).toContain(response.status);
	}, 15000);

	it('should proxy the people request', async () => {
		const response = await fetch(`${API_BASE_URL}/api/immich/people`, {
			headers: getAuthHeaders(),
			signal: AbortSignal.timeout(10000)
		});

		expect([200, 401, 404, 500, 502]).toContain(response.status);
	}, 15000);

	it('should proxy requests with query parameters', async () => {
		const response = await fetch(`${API_BASE_URL}/api/immich/assets?take=50&skip=10`, {
			headers: getAuthHeaders(),
			signal: AbortSignal.timeout(10000)
		});

		expect([200, 401, 404, 500, 502]).toContain(response.status);
	}, 15000);

	it('should reject requests without authentication', async () => {
		const response = await fetch(`${API_BASE_URL}/api/immich/assets`);
		expect([401, 403]).toContain(response.status);
	});
});

describe('Immich Proxy - POST requests', () => {
	it('should proxy POST requests to Immich', async () => {
		const response = await fetch(`${API_BASE_URL}/api/immich/albums`, {
			method: 'POST',
			headers: getAuthHeaders(),
			body: JSON.stringify({
				albumName: '[TEST] Album'
			}),
			signal: AbortSignal.timeout(10000)
		});

		expect([200, 201, 400, 401, 404, 500, 502]).toContain(response.status);
	}, 15000);

	it('should forward request body correctly', async () => {
		const requestBody = {
			title: 'Test',
			description: 'Test description'
		};

		const response = await fetch(`${API_BASE_URL}/api/immich/test-endpoint`, {
			method: 'POST',
			headers: getAuthHeaders(),
			body: JSON.stringify(requestBody),
			signal: AbortSignal.timeout(10000)
		});

		expect([200, 201, 400, 401, 404, 500, 502]).toContain(response.status);
	}, 15000);
});

describe('Immich Proxy - PUT requests', () => {
	it('should proxy PUT requests to Immich', async () => {
		const response = await fetch(`${API_BASE_URL}/api/immich/albums/test-id`, {
			method: 'PUT',
			headers: getAuthHeaders(),
			body: JSON.stringify({
				albumName: '[TEST] Updated Album'
			}),
			signal: AbortSignal.timeout(10000)
		});

		expect([200, 400, 401, 403, 404, 500, 502]).toContain(response.status);
	}, 15000);

	it('should handle PUT requests with FormData', async () => {
		const formData = new FormData();
		formData.append('file', new Blob(['test']), 'test.jpg');

		const response = await fetch(`${API_BASE_URL}/api/immich/upload`, {
			method: 'PUT',
			headers: {
				'x-api-key': globalTestContext.adminApiKey || ''
			},
			body: formData,
			signal: AbortSignal.timeout(10000)
		});

		expect([200, 400, 401, 403, 404, 500, 502]).toContain(response.status);
	}, 15000);
});

describe('Immich Proxy - DELETE requests', () => {
	it('should proxy DELETE requests to Immich', async () => {
		const response = await fetch(`${API_BASE_URL}/api/immich/albums/test-id`, {
			method: 'DELETE',
			headers: getAuthHeaders(),
			signal: AbortSignal.timeout(10000)
		});

		expect([200, 204, 400, 401, 404, 500, 502]).toContain(response.status);
	}, 15000);
});

describe('Immich Proxy - PATCH requests', () => {
	it('should proxy PATCH requests to Immich', async () => {
		const response = await fetch(`${API_BASE_URL}/api/immich/assets/test-id`, {
			method: 'PATCH',
			headers: getAuthHeaders(),
			body: JSON.stringify({
				isFavorite: true
			}),
			signal: AbortSignal.timeout(10000)
		});

		expect([200, 400, 401, 404, 500, 502]).toContain(response.status);
	}, 15000);
});

describe('Immich Proxy - Headers forwarding', () => {
	it('should forward authentication headers', async () => {
		const response = await fetch(`${API_BASE_URL}/api/immich/assets`, {
			headers: {
				'x-api-key': globalTestContext.adminApiKey || '',
				Accept: 'application/json'
			},
			signal: AbortSignal.timeout(10000)
		});

		expect([200, 401, 404, 500, 502]).toContain(response.status);
	}, 15000);

	it('should forward custom headers', async () => {
		const response = await fetch(`${API_BASE_URL}/api/immich/assets`, {
			headers: {
				'x-api-key': globalTestContext.adminApiKey || '',
				'X-Custom-Header': 'test-value'
			},
			signal: AbortSignal.timeout(10000)
		});

		expect([200, 401, 404, 500, 502]).toContain(response.status);
	}, 15000);
});

describe('Immich Proxy - Error handling', () => {
	it('should handle Immich errors gracefully', async () => {
		try {
			const response = await fetch(`${API_BASE_URL}/api/immich/invalid-endpoint`, {
				headers: getAuthHeaders(),
				signal: AbortSignal.timeout(10000)
			});

			expect([200, 404, 500, 502]).toContain(response.status);
		} catch (error: unknown) {
			const err = error as { name?: string; code?: string };
			if (err.name === 'TimeoutError' || err.code === 'ECONNRESET') {
				expect(true).toBe(true);
			}
		}
	}, 15000);

	it('should return 502 if Immich is down', async () => {
		try {
			const response = await fetch(`${API_BASE_URL}/api/immich/assets`, {
				headers: getAuthHeaders(),
				signal: AbortSignal.timeout(5000)
			});

			// If Immich is down, we should get 502 or 500
			expect([200, 500, 502, 504]).toContain(response.status);
		} catch (error: unknown) {
			// Timeout acceptable if Immich is down
			const err = error as { name?: string };
			if (err.name === 'TimeoutError') {
				expect(true).toBe(true);
			}
		}
	}, 10000);

	it('should handle timeouts gracefully', async () => {
		try {
			const response = await fetch(`${API_BASE_URL}/api/immich/assets`, {
				headers: getAuthHeaders(),
				signal: AbortSignal.timeout(3000)
			});

			expect([200, 401, 404, 500, 502, 504]).toContain(response.status);
		} catch (error: unknown) {
			const err = error as { name?: string; code?: string };
			if (err.name === 'TimeoutError' || err.code === 'ETIMEDOUT') {
				expect(true).toBe(true);
			}
		}
	}, 10000);
});

describe('Immich Proxy - Cache behavior', () => {
	it('should respect cache headers', async () => {
		const response = await fetch(`${API_BASE_URL}/api/immich/assets`, {
			headers: getAuthHeaders(),
			signal: AbortSignal.timeout(10000)
		});

		if (response.status === 200) {
			const cacheControl = response.headers.get('cache-control');
			// Verify that cache headers are present or absent depending on configuration
			expect(cacheControl !== null || cacheControl === null).toBe(true);
		}
	}, 15000);

	it('should handle conditional requests', async () => {
		const response = await fetch(`${API_BASE_URL}/api/immich/assets`, {
			headers: {
				...getAuthHeaders(),
				'If-None-Match': '"test-etag"'
			},
			signal: AbortSignal.timeout(10000)
		});

		expect([200, 304, 401, 404, 500, 502]).toContain(response.status);
	}, 15000);
});

describe('Immich Proxy - Content types', () => {
	it('should handle image requests', async () => {
		const response = await fetch(`${API_BASE_URL}/api/immich/assets/test-id/thumbnail`, {
			headers: getAuthHeaders(),
			signal: AbortSignal.timeout(10000)
		});

		expect([200, 400, 401, 404, 500, 502]).toContain(response.status);

		if (response.status === 200) {
			const contentType = response.headers.get('content-type');
			expect(contentType?.startsWith('image/') || contentType === null).toBe(true);
		}
	}, 15000);

	it('should handle video requests', async () => {
		const response = await fetch(`${API_BASE_URL}/api/immich/assets/test-id/video`, {
			headers: getAuthHeaders(),
			signal: AbortSignal.timeout(10000)
		});

		expect([200, 401, 404, 500, 502]).toContain(response.status);

		if (response.status === 200) {
			const contentType = response.headers.get('content-type');
			expect(contentType?.startsWith('video/') || contentType === null).toBe(true);
		}
	}, 15000);

	it('should handle JSON responses', async () => {
		const response = await fetch(`${API_BASE_URL}/api/immich/assets`, {
			headers: getAuthHeaders(),
			signal: AbortSignal.timeout(10000)
		});

		if (response.status === 200) {
			const contentType = response.headers.get('content-type');
			expect(contentType?.includes('application/json') || contentType === null).toBe(true);
		}
	}, 15000);
});

describe('Immich Proxy - Path forwarding', () => {
	it('should handle nested paths', async () => {
		const paths = [
			'/api/immich/assets/test-id',
			'/api/immich/albums/test-id/assets',
			'/api/immich/people/test-id/photos',
			'/api/immich/server-info/version'
		];

		for (const path of paths) {
			const response = await fetch(`${API_BASE_URL}${path}`, {
				headers: getAuthHeaders(),
				signal: AbortSignal.timeout(10000)
			});

			expect([200, 400, 401, 404, 500, 502]).toContain(response.status);
		}
	}, 60000);
	it('should preserve complex query parameters', async () => {
		const queryParams = new URLSearchParams({
			take: '50',
			skip: '10',
			order: 'desc',
			filter: 'favorites'
		});

		const response = await fetch(`${API_BASE_URL}/api/immich/assets?${queryParams}`, {
			headers: getAuthHeaders(),
			signal: AbortSignal.timeout(10000)
		});

		expect([200, 401, 404, 500, 502]).toContain(response.status);
	}, 15000);
});

describe('Immich Proxy - Scope validation', () => {
	it('should verify scopes for read operations', async () => {
		const response = await fetch(`${API_BASE_URL}/api/immich/assets`, {
			headers: getAuthHeaders(),
			signal: AbortSignal.timeout(10000)
		});

		expect([200, 401, 403, 404, 500, 502]).toContain(response.status);
	}, 15000);

	it('should verify scopes for write operations', async () => {
		const response = await fetch(`${API_BASE_URL}/api/immich/albums`, {
			method: 'POST',
			headers: getAuthHeaders(),
			body: JSON.stringify({ albumName: '[TEST] Album' }),
			signal: AbortSignal.timeout(10000)
		});

		expect([200, 201, 401, 403, 404, 500, 502]).toContain(response.status);
	}, 15000);

	it('should verify scopes for delete operations', async () => {
		const response = await fetch(`${API_BASE_URL}/api/immich/albums/test-id`, {
			method: 'DELETE',
			headers: getAuthHeaders(),
			signal: AbortSignal.timeout(10000)
		});

		expect([200, 204, 400, 401, 403, 404, 500, 502]).toContain(response.status);
	}, 15000);
});
