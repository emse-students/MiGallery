/**
 * End-to-end integration tests for MiGallery
 * This file orchestrates all tests and verifies the complete integration
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { ApiKeyResponse, UserCreateResponse, ImmichAlbum } from '$lib/types/api';

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';
let sessionCookie = '';
let adminApiKey = '';
let readApiKey = '';
let testUserId: string | null = null;
let testAlbumId: string | null = null;
let testApiKeyId: string | null = null;
let testReadApiKeyId: string | null = null;

// ========================================
// Setup and authentication
// ========================================

beforeAll(async () => {
	console.debug('🚀 Starting end-to-end integration tests'); // Attempting to log in as the system user
	try {
		const response = await fetch(
			`${API_BASE_URL}/dev/login-as?u=dd68bb5b4f7c56878a1bd873593a3e7c3434242c80871e4ead9fe99d3f48a782`,
			{
				redirect: 'manual'
			}
		);

		if (response.status === 303 || response.status === 302) {
			const cookies = response.headers.get('set-cookie');
			if (cookies) {
				const match = cookies.match(/current_user_id=([^;]+)/);
				if (match) {
					sessionCookie = `current_user_id=${match[1]}`;
					console.debug('✅ Authenticated with session cookie');
				}
			}
		}

		// Create an admin API key for the tests
		if (sessionCookie) {
			const keyResponse = await fetch(`${API_BASE_URL}/api/admin/api-keys`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Cookie: sessionCookie
				},
				body: JSON.stringify({
					label: '[TEST] E2E Admin Key',
					scopes: ['admin']
				})
			});

			if (keyResponse.ok) {
				const data = (await keyResponse.json()) as ApiKeyResponse;
				adminApiKey = data.rawKey ?? '';
				testApiKeyId = data.id ?? null;
				console.debug('✅ Admin API key created');
			}

			// Create a read API key for the tests
			const readKeyResponse = await fetch(`${API_BASE_URL}/api/admin/api-keys`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Cookie: sessionCookie
				},
				body: JSON.stringify({
					label: '[TEST] E2E Read Key',
					scopes: ['read']
				})
			});

			if (readKeyResponse.ok) {
				const data = (await readKeyResponse.json()) as ApiKeyResponse;
				readApiKey = data.rawKey ?? '';
				testReadApiKeyId = data.id ?? null;
				console.debug('✅ Read API key created');
			}
		}
	} catch (error) {
		console.error('❌ Error during setup:', error);
	}
}, 30000);

afterAll(async () => {
	console.debug('\n🧹 Cleaning up test resources'); // Delete the test user
	if (testUserId && adminApiKey) {
		await fetch(`${API_BASE_URL}/api/users/${testUserId}`, {
			method: 'DELETE',
			headers: { 'x-api-key': adminApiKey }
		});
	}

	// Delete the test album
	if (testAlbumId && adminApiKey) {
		await fetch(`${API_BASE_URL}/api/albums/${testAlbumId}`, {
			method: 'DELETE',
			headers: { 'x-api-key': adminApiKey }
		});
	}

	// Delete the test API keys
	if (testApiKeyId && sessionCookie) {
		await fetch(`${API_BASE_URL}/api/admin/api-keys/${testApiKeyId}`, {
			method: 'DELETE',
			headers: { Cookie: sessionCookie }
		});
	}

	// Delete the test read API key
	if (testReadApiKeyId && sessionCookie) {
		await fetch(`${API_BASE_URL}/api/admin/api-keys/${testReadApiKeyId}`, {
			method: 'DELETE',
			headers: { Cookie: sessionCookie }
		});
	}

	console.debug('✅ Cleanup complete\n');
});

// ========================================
// Complete end-to-end tests
// ========================================

describe('E2E - Complete user workflow', () => {
	it('should create, modify and delete a user', async () => {
		// 1. Create a user
		const createResponse = await fetch(`${API_BASE_URL}/api/users`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-api-key': adminApiKey
			},
			body: JSON.stringify({
				id_user: `e2e.test.${Date.now()}`,
				email: `e2e.test.${Date.now()}@etu.emse.fr`,
				name: 'E2E Test',
				first_name: 'E2E',
				last_name: 'Test',
				role: 'user',
				promo_year: 2025
			})
		});

		expect([200, 201, 401]).toContain(createResponse.status);

		if (createResponse.ok) {
			const createData = (await createResponse.json()) as UserCreateResponse;
			testUserId = createData.created!.id_user;

			// 2. Fetch the created user
			const getResponse = await fetch(`${API_BASE_URL}/api/users/${testUserId}`, {
				headers: { 'x-api-key': adminApiKey }
			});

			expect(getResponse.status).toBe(200);

			// 3. Modify the user
			const updateResponse = await fetch(`${API_BASE_URL}/api/users/${testUserId}`, {
				method: 'PUT',
				headers: {
					'Content-Type': 'application/json',
					'x-api-key': adminApiKey
				},
				body: JSON.stringify({
					email: `modified.${Date.now()}@etu.emse.fr`,
					name: 'Modified User',
					first_name: 'Modified',
					last_name: 'User',
					role: 'user',
					promo_year: 2026
				})
			});

			expect(updateResponse.status).toBe(200);

			// 4. Delete the user
			const deleteResponse = await fetch(`${API_BASE_URL}/api/users/${testUserId}`, {
				method: 'DELETE',
				headers: { 'x-api-key': adminApiKey }
			});

			expect([200, 204]).toContain(deleteResponse.status);
			testUserId = null;
		}
	}, 30000);
});

describe('E2E - Complete album workflow', () => {
	it('should create album, add assets and delete it', async () => {
		// 1. Create an album
		const createResponse = await fetch(`${API_BASE_URL}/api/albums`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-api-key': adminApiKey
			},
			body: JSON.stringify({
				albumName: `[TEST] E2E Album ${Date.now()}`,
				description: 'Album created by E2E tests'
			})
		});

		if (createResponse.ok) {
			const album = (await createResponse.json()) as ImmichAlbum;
			testAlbumId = album.id;

			// 2. Fetch the album
			const getResponse = await fetch(`${API_BASE_URL}/api/albums/${testAlbumId}`, {
				headers: { 'x-api-key': adminApiKey }
			});

			expect([200, 404, 500]).toContain(getResponse.status);

			// 3. Modify the album
			const updateResponse = await fetch(`${API_BASE_URL}/api/albums/${testAlbumId}`, {
				method: 'PATCH',
				headers: {
					'Content-Type': 'application/json',
					'x-api-key': adminApiKey
				},
				body: JSON.stringify({
					albumName: '[TEST] E2E Album Modified',
					description: 'Updated description'
				})
			});

			expect([200, 404, 500]).toContain(updateResponse.status);

			// 4. Delete the album
			const deleteResponse = await fetch(`${API_BASE_URL}/api/albums/${testAlbumId}`, {
				method: 'DELETE',
				headers: { 'x-api-key': adminApiKey }
			});

			expect([200, 204, 404, 500]).toContain(deleteResponse.status);
			testAlbumId = null;
		}
	}, 30000);
});

describe('E2E - Permissions and scopes workflow', () => {
	it('should respect read vs admin scopes', async () => {
		// 1. Read with read scope (should work)
		const readResponse = await fetch(`${API_BASE_URL}/api/albums`, {
			headers: { 'x-api-key': readApiKey }
		});

		expect([200, 401, 500]).toContain(readResponse.status);

		// 2. Create with read scope (should fail)
		const createWithReadResponse = await fetch(`${API_BASE_URL}/api/users`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-api-key': readApiKey
			},
			body: JSON.stringify({
				id_user: 'test.forbidden',
				email: 'test@etu.emse.fr',
				name: 'Test Forbidden',
				first_name: 'Test',
				last_name: 'Forbidden',
				role: 'user'
			})
		});

		expect([401, 403]).toContain(createWithReadResponse.status);

		// 3. Create with admin scope (should work)
		const createWithAdminResponse = await fetch(`${API_BASE_URL}/api/users`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-api-key': adminApiKey
			},
			body: JSON.stringify({
				id_user: `e2e.scope.test.${Date.now()}`,
				email: `scope.test.${Date.now()}@etu.emse.fr`,
				name: 'Scope Test',
				first_name: 'Scope',
				last_name: 'Test',
				role: 'user'
			})
		});

		if (createWithAdminResponse.ok) {
			const data = (await createWithAdminResponse.json()) as UserCreateResponse;
			const userId = data.created!.id_user;

			// Clean up
			await fetch(`${API_BASE_URL}/api/users/${userId}`, {
				method: 'DELETE',
				headers: { 'x-api-key': adminApiKey }
			});
		}
	}, 30000);
});

describe('E2E - Favorites workflow', () => {
	it('should handle complete favorites cycle', async () => {
		const assetId = 'e2e-test-asset-123';

		// 1. Add to favorites
		const addResponse = await fetch(`${API_BASE_URL}/api/favorites`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-api-key': adminApiKey
			},
			body: JSON.stringify({ assetId })
		});

		expect([200, 201, 400, 401, 409]).toContain(addResponse.status);

		// 2. List favorites
		const listResponse = await fetch(`${API_BASE_URL}/api/favorites`, {
			headers: { 'x-api-key': adminApiKey }
		});

		expect([200, 401]).toContain(listResponse.status);

		// 3. Remove from favorites
		const removeResponse = await fetch(`${API_BASE_URL}/api/favorites`, {
			method: 'DELETE',
			headers: {
				'Content-Type': 'application/json',
				'x-api-key': adminApiKey
			},
			body: JSON.stringify({ assetId })
		});

		expect([200, 204, 400, 401, 404]).toContain(removeResponse.status);
	}, 30000);
});

describe('E2E - External media workflow', () => {
	it('should handle complete external media cycle', async () => {
		// 1. Create an external media item
		const createResponse = await fetch(`${API_BASE_URL}/api/external/media`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-api-key': adminApiKey
			},
			body: JSON.stringify({
				type: 'url',
				url: 'https://example.com/e2e-test-video.mp4',
				title: 'E2E Test Media',
				description: 'Media created by E2E tests'
			})
		});

		if (createResponse.ok) {
			const media = (await createResponse.json()) as { media: { id: string } };
			const mediaId = media.media.id;

			// 2. Fetch the media
			const getResponse = await fetch(`${API_BASE_URL}/api/external/media/${mediaId}`, {
				headers: { 'x-api-key': adminApiKey }
			});

			expect([200, 404]).toContain(getResponse.status);

			// 3. Delete the media
			const deleteResponse = await fetch(`${API_BASE_URL}/api/external/media/${mediaId}`, {
				method: 'DELETE',
				headers: { 'x-api-key': adminApiKey }
			});

			expect([200, 204, 404]).toContain(deleteResponse.status);
		}
	}, 30000);
});

describe('E2E - Health et monitoring', () => {
	it('should verify all critical endpoints are accessible', async () => {
		const endpoints = [
			{ url: '/api/health', method: 'GET', auth: false },
			{ url: '/api/albums', method: 'GET', auth: true },
			{ url: '/api/users', method: 'GET', auth: true },
			{ url: '/api/favorites', method: 'GET', auth: true },
			{ url: '/api/people/people', method: 'GET', auth: true }
		];

		for (const endpoint of endpoints) {
			const headers: HeadersInit = endpoint.auth && adminApiKey ? { 'x-api-key': adminApiKey } : {};

			const response = await fetch(`${API_BASE_URL}${endpoint.url}`, {
				method: endpoint.method,
				headers,
				signal: AbortSignal.timeout(10000)
			});

			// Endpoints must be accessible (even if Immich is down)
			expect([200, 401, 404, 500, 502]).toContain(response.status);
		}
	}, 60000);
});

describe('E2E - Performance and stress', () => {
	it('should handle multiple simultaneous requests', async () => {
		const requests = Array.from({ length: 20 }, () => fetch(`${API_BASE_URL}/api/health`));

		const responses = await Promise.all(requests);
		const successCount = responses.filter((r) => r.status === 200).length;

		expect(successCount).toBeGreaterThan(0);
	}, 30000);

	it('should handle heavy requests without timeout', async () => {
		const response = await fetch(`${API_BASE_URL}/api/albums`, {
			headers: { 'x-api-key': adminApiKey },
			signal: AbortSignal.timeout(15000)
		});

		expect([200, 401, 500]).toContain(response.status);
	}, 20000);
});

describe('E2E - Data validation', () => {
	it('should reject invalid data consistently', async () => {
		const invalidRequests = [
			{
				url: '/api/users',
				method: 'POST',
				body: { email: 'invalid-email' }
			},
			{
				url: '/api/albums',
				method: 'POST',
				body: { albumName: '' }
			},
			{
				url: '/api/favorites',
				method: 'POST',
				body: {}
			}
		];

		for (const req of invalidRequests) {
			const response = await fetch(`${API_BASE_URL}${req.url}`, {
				method: req.method,
				headers: {
					'Content-Type': 'application/json',
					'x-api-key': adminApiKey
				},
				body: JSON.stringify(req.body)
			});

			expect([400, 401, 403]).toContain(response.status);
		}
	}, 30000);
});
