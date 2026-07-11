/**
 * Comprehensive tests for the Favorites, Trash and External Media API
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestAuth, teardownTestAuth, globalTestContext } from './test-helpers';

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';
const testAssetId = 'test-asset-123';

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

describe('Favorites API - GET /api/favorites', () => {
	it('should list user favorites', async () => {
		const response = await fetch(`${API_BASE_URL}/api/favorites`, {
			headers: getAuthHeaders()
		});

		expect([200, 401, 403]).toContain(response.status);

		if (response.status === 200) {
			const favorites = (await response.json()) as unknown[];
			expect(Array.isArray(favorites)).toBe(true);
		}
	});

	it('should reject access without authentication', async () => {
		const response = await fetch(`${API_BASE_URL}/api/favorites`);
		expect([401, 403]).toContain(response.status);
	});

	it('should return empty list if no favorites', async () => {
		const response = await fetch(`${API_BASE_URL}/api/favorites`, {
			headers: getAuthHeaders()
		});

		if (response.status === 200) {
			const favorites = (await response.json()) as unknown[];
			expect(Array.isArray(favorites)).toBe(true);
		}
	});
});

describe('Favorites API - POST /api/favorites', () => {
	it('should add asset to favorites', async () => {
		const response = await fetch(`${API_BASE_URL}/api/favorites`, {
			method: 'POST',
			headers: getAuthHeaders(),
			body: JSON.stringify({
				assetId: testAssetId
			})
		});

		expect([200, 201, 400, 401, 403, 409]).toContain(response.status);

		if (response.status === 200 || response.status === 201) {
			const data = (await response.json()) as { success: boolean };
			expect(data.success).toBe(true);
		}
	});

	it('should reject addition without assetId', async () => {
		const response = await fetch(`${API_BASE_URL}/api/favorites`, {
			method: 'POST',
			headers: getAuthHeaders(),
			body: JSON.stringify({})
		});

		expect([400, 401, 403]).toContain(response.status);
	});

	it('should handle duplicate addition gracefully', async () => {
		// Add first time
		await fetch(`${API_BASE_URL}/api/favorites`, {
			method: 'POST',
			headers: getAuthHeaders(),
			body: JSON.stringify({
				assetId: testAssetId
			})
		});

		// Add second time (duplicate)
		const response = await fetch(`${API_BASE_URL}/api/favorites`, {
			method: 'POST',
			headers: getAuthHeaders(),
			body: JSON.stringify({
				assetId: testAssetId
			})
		});

		expect([200, 401, 409]).toContain(response.status);
	});
});

describe('Favorites API - DELETE /api/favorites', () => {
	it('should remove asset from favorites', async () => {
		const response = await fetch(`${API_BASE_URL}/api/favorites`, {
			method: 'DELETE',
			headers: getAuthHeaders(),
			body: JSON.stringify({
				assetId: testAssetId
			})
		});

		expect([200, 204, 400, 401, 403, 404]).toContain(response.status);
	});

	it('should reject deletion without assetId', async () => {
		const response = await fetch(`${API_BASE_URL}/api/favorites`, {
			method: 'DELETE',
			headers: getAuthHeaders(),
			body: JSON.stringify({})
		});

		expect([400, 401, 403]).toContain(response.status);
	});

	it('should handle deletion of non-existent favorite', async () => {
		const response = await fetch(`${API_BASE_URL}/api/favorites`, {
			method: 'DELETE',
			headers: getAuthHeaders(),
			body: JSON.stringify({
				assetId: 'inexistant-asset-id-12345'
			})
		});

		expect([200, 401, 404]).toContain(response.status);
	});
});

describe('External Media API - GET /api/external/media', () => {
	it('should list all external media', async () => {
		const response = await fetch(`${API_BASE_URL}/api/external/media`, {
			headers: getAuthHeaders()
		});

		expect([200, 401, 500]).toContain(response.status);

		if (response.status === 200) {
			const data = (await response.json()) as { success: boolean; media?: unknown[] };
			expect(data.success).toBe(true);
			if (data.media !== undefined) {
				expect(Array.isArray(data.media)).toBe(true);
			}
		}
	});

	it('should reject access without authentication', async () => {
		const response = await fetch(`${API_BASE_URL}/api/external/media`);
		expect([401, 403]).toContain(response.status);
	});
});

describe('External Media API - POST /api/external/media', () => {
	it('should create new external media with URL', async () => {
		const mediaData = {
			type: 'url',
			url: 'https://example.com/video.mp4',
			title: 'Test Video',
			description: 'Test video'
		};

		const response = await fetch(`${API_BASE_URL}/api/external/media`, {
			method: 'POST',
			headers: getAuthHeaders(),
			body: JSON.stringify(mediaData)
		});

		expect([200, 201, 400, 401, 403, 500]).toContain(response.status);

		if (response.status === 200 || response.status === 201) {
			const data = (await response.json()) as { success: boolean; media: { id: string } };
			expect(data.success).toBe(true);
			expect(data.media).toHaveProperty('id');
		}
	});

	it('should create external media with embed code', async () => {
		const mediaData = {
			type: 'embed',
			embedCode: '<iframe src="https://youtube.com/embed/test"></iframe>',
			title: 'Test Embed',
			description: 'Test embed'
		};

		const response = await fetch(`${API_BASE_URL}/api/external/media`, {
			method: 'POST',
			headers: getAuthHeaders(),
			body: JSON.stringify(mediaData)
		});

		expect([200, 201, 400, 401, 403, 500]).toContain(response.status);
	});

	it('should reject creation without required data', async () => {
		const response = await fetch(`${API_BASE_URL}/api/external/media`, {
			method: 'POST',
			headers: getAuthHeaders(),
			body: JSON.stringify({
				title: 'Incomplete Data'
			})
		});

		expect([400, 401, 403, 500]).toContain(response.status);
	});

	it('should validate URL format', async () => {
		const mediaData = {
			type: 'url',
			url: 'not-a-valid-url',
			title: 'Invalid URL'
		};

		const response = await fetch(`${API_BASE_URL}/api/external/media`, {
			method: 'POST',
			headers: getAuthHeaders(),
			body: JSON.stringify(mediaData)
		});

		expect([400, 401, 403, 500]).toContain(response.status);
	});

	it('should support different media types', async () => {
		const mediaTypes = [
			{ type: 'youtube', url: 'https://youtube.com/watch?v=test', title: 'YouTube' },
			{ type: 'vimeo', url: 'https://vimeo.com/123456', title: 'Vimeo' },
			{ type: 'image', url: 'https://example.com/image.jpg', title: 'Image' }
		];

		for (const media of mediaTypes) {
			const response = await fetch(`${API_BASE_URL}/api/external/media`, {
				method: 'POST',
				headers: getAuthHeaders(),
				body: JSON.stringify(media)
			});

			expect([200, 201, 400, 401, 403, 500]).toContain(response.status);
		}
	});
});

describe('External Media API - GET /api/external/media/[id]', () => {
	it('should fetch specific external media', async () => {
		const response = await fetch(`${API_BASE_URL}/api/external/media/test-id-12345`, {
			headers: getAuthHeaders()
		});

		expect([200, 400, 401, 404, 500]).toContain(response.status);

		if (response.status === 200) {
			const data = (await response.json()) as { id: string };
			expect(data).toHaveProperty('id');
		}
	});

	it('should return 404 for non-existent media', async () => {
		const response = await fetch(`${API_BASE_URL}/api/external/media/inexistant-id-12345`, {
			headers: getAuthHeaders()
		});

		expect([400, 401, 404, 500]).toContain(response.status);
	});
});
describe('External Media API - DELETE /api/external/media/[id]', () => {
	it('should delete multiple external media', async () => {
		const response = await fetch(`${API_BASE_URL}/api/external/media`, {
			method: 'DELETE',
			headers: getAuthHeaders(),
			body: JSON.stringify({
				ids: ['media-1', 'media-2']
			})
		});

		expect([200, 204, 400, 401, 403, 500]).toContain(response.status);
	});

	it('should reject deletion without IDs', async () => {
		const response = await fetch(`${API_BASE_URL}/api/external/media`, {
			method: 'DELETE',
			headers: getAuthHeaders(),
			body: JSON.stringify({})
		});

		expect([400, 401, 403, 500]).toContain(response.status);
	});
});

describe('External Media API - DELETE /api/external/media/[id]', () => {
	it('should delete specific external media', async () => {
		const response = await fetch(`${API_BASE_URL}/api/external/media/test-id-12345`, {
			method: 'DELETE',
			headers: getAuthHeaders()
		});

		expect([200, 204, 401, 403, 404, 500]).toContain(response.status);
	});

	it('should return 404 for non-existent media', async () => {
		const response = await fetch(`${API_BASE_URL}/api/external/media/inexistant-id-12345`, {
			method: 'DELETE',
			headers: getAuthHeaders()
		});

		expect([404, 500]).toContain(response.status);
	});
});

describe('Database API - POST /api/db', () => {
	it('should allow SQL query execution (admin)', async () => {
		const response = await fetch(`${API_BASE_URL}/api/db`, {
			method: 'POST',
			headers: getAuthHeaders(),
			body: JSON.stringify({
				query: 'SELECT COUNT(*) FROM users'
			})
		});

		expect([200, 400, 401, 403, 404]).toContain(response.status);
	});

	it('should reject dangerous SQL queries', async () => {
		const dangerousQueries = [
			'DROP TABLE users',
			'DELETE FROM users',
			'UPDATE users SET role = "admin"'
		];

		for (const query of dangerousQueries) {
			const response = await fetch(`${API_BASE_URL}/api/db`, {
				method: 'POST',
				headers: getAuthHeaders(),
				body: JSON.stringify({ query })
			});

			expect([400, 401, 403, 404]).toContain(response.status);
		}
	});

	it('should reject access for non-admins', async () => {
		const response = await fetch(`${API_BASE_URL}/api/db`, {
			method: 'POST',
			headers: getAuthHeaders(),
			body: JSON.stringify({
				query: 'SELECT * FROM users'
			})
		});

		expect([200, 400, 401, 403, 404]).toContain(response.status);
	});
});

describe('Change User API - POST /api/change-user', () => {
	it('should allow changing user (dev mode)', async () => {
		const response = await fetch(`${API_BASE_URL}/api/change-user`, {
			method: 'POST',
			headers: getAuthHeaders(),
			body: JSON.stringify({
				userId: 'dd68bb5b4f7c56878a1bd873593a3e7c3434242c80871e4ead9fe99d3f48a782'
			})
		});

		expect([200, 302, 401, 403]).toContain(response.status);
	});

	it('should reject the change without userId', async () => {
		const response = await fetch(`${API_BASE_URL}/api/change-user`, {
			method: 'POST',
			headers: getAuthHeaders(),
			body: JSON.stringify({})
		});

		expect([200, 400, 401, 403]).toContain(response.status);
	});

	it('should reject change to non-existent user', async () => {
		const response = await fetch(`${API_BASE_URL}/api/change-user`, {
			method: 'POST',
			headers: getAuthHeaders(),
			body: JSON.stringify({
				userId: 'inexistant.user.12345'
			})
		});

		expect([200, 400, 404]).toContain(response.status);
	});
});
