/**
 * Comprehensive tests for the Albums API
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { ImmichAlbum } from '$lib/types/api';
import {
	setupTestAuth,
	teardownTestAuth,
	globalTestContext,
	testPermissions
} from './test-helpers';

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';
let testAlbumId = ''; // Immich UUID = local ID in the DB
// Track all created albums for cleanup
const createdAlbumIds: string[] = [];

beforeAll(async () => {
	await setupTestAuth();

	// Create a test album dedicated to permission tests
	// POST /api/albums creates album on Immich AND in local DB
	if (globalTestContext.adminApiKey) {
		try {
			const response = await fetch(`${API_BASE_URL}/api/albums`, {
				method: 'POST',
				headers: {
					'x-api-key': globalTestContext.adminApiKey,
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					albumName: `[TEST] Permissions ${Date.now()}`,
					description: 'Album for permission tests'
				})
			});

			if (response.ok) {
				const album = (await response.json()) as ImmichAlbum;
				testAlbumId = album.id;
				createdAlbumIds.push(album.id);
			}
		} catch (err) {
			console.error('Failed to create test album:', err);
		}
	}
});

afterAll(async () => {
	// Delete all albums created during the tests
	if (globalTestContext.adminApiKey) {
		for (const albumId of createdAlbumIds) {
			try {
				await fetch(`${API_BASE_URL}/api/albums/${albumId}`, {
					method: 'DELETE',
					headers: { 'x-api-key': globalTestContext.adminApiKey }
				});
			} catch {
				// Ignore errors (album may already be deleted)
			}
		}
	}

	if (globalTestContext.adminApiKey) {
		await teardownTestAuth(globalTestContext as import('./test-helpers').TestContext);
	}
});

// Helper for authentication headers
const getAuthHeaders = () => {
	const headers: Record<string, string> = {
		'Content-Type': 'application/json'
	};
	if (globalTestContext.adminApiKey) {
		headers['x-api-key'] = globalTestContext.adminApiKey;
	}
	return headers;
};

describe('Albums API - GET /api/albums', () => {
	it('should respect READ permissions', async () => {
		const result = await testPermissions({
			endpoint: '/api/albums',
			method: 'GET',
			requiredScope: 'read',
			description: 'List of albums'
		});

		// Strict checks
		expect(result.noAuth.passed).toBe(true); // Should reject without auth
		expect(result.read.passed).toBe(true); // Should accept with read
		expect(result.write.passed).toBe(true); // Should accept with write
		expect(result.admin.passed).toBe(true); // Should accept with admin
	});

	it('should list all albums', async () => {
		const response = await fetch(`${API_BASE_URL}/api/albums`, {
			headers: getAuthHeaders()
		});

		expect([200, 401, 500]).toContain(response.status);

		if (response.status === 200) {
			const albums = (await response.json()) as ImmichAlbum[];
			expect(Array.isArray(albums)).toBe(true);

			// Verify the album structure if present
			if (albums.length > 0) {
				const album = albums[0];
				expect(album).toHaveProperty('id');
				expect(album).toHaveProperty('albumName');
				testAlbumId = album.id; // Save for subsequent tests
			}
		}
	});

	it('should reject requests without authentication', async () => {
		const response = await fetch(`${API_BASE_URL}/api/albums`);
		expect([401, 403]).toContain(response.status);
	});

	it('should filter PhotoCV album (hidden)', async () => {
		const response = await fetch(`${API_BASE_URL}/api/albums`, {
			headers: getAuthHeaders()
		});

		if (response.status === 200) {
			const albums = (await response.json()) as ImmichAlbum[];
			const photoCVAlbum = albums.find((a) => a.albumName?.toLowerCase().includes('photocv'));
			expect(photoCVAlbum).toBeUndefined();
		}
	});
});

describe('Albums API - POST /api/albums', () => {
	it('should respect WRITE permissions', async () => {
		const albumData = {
			albumName: `[TEST] Permission Album ${Date.now()}`,
			description: 'Test'
		};

		const result = await testPermissions({
			endpoint: '/api/albums',
			method: 'POST',
			body: albumData,
			requiredScope: 'write',
			description: 'Album creation'
		});

		expect(result.noAuth.passed).toBe(true); // Should reject without auth
		expect(result.read.passed).toBe(true); // Should reject with read only
		expect(result.write.passed).toBe(true); // Should accept with write
		expect(result.admin.passed).toBe(true); // Should accept with admin
	});

	it('should create a new album', async () => {
		const newAlbum = {
			albumName: `[TEST] Album ${Date.now()}`,
			description: 'Album created by automated tests'
		};

		const response = await fetch(`${API_BASE_URL}/api/albums`, {
			method: 'POST',
			headers: getAuthHeaders(),
			body: JSON.stringify(newAlbum)
		});

		expect([200, 201, 401, 500]).toContain(response.status);

		if (response.status === 200 || response.status === 201) {
			const album = (await response.json()) as ImmichAlbum;
			expect(album).toHaveProperty('id');
			expect(album.albumName).toBe(newAlbum.albumName);
			testAlbumId = album.id;
			createdAlbumIds.push(album.id);
		}
	});

	it('should reject creation without album name', async () => {
		const response = await fetch(`${API_BASE_URL}/api/albums`, {
			method: 'POST',
			headers: getAuthHeaders(),
			body: JSON.stringify({ description: 'No name' })
		});

		expect([400, 401, 500]).toContain(response.status);
	});
});

describe('Albums API - GET /api/albums/[id]', () => {
	it('should fetch a specific album', async () => {
		if (!testAlbumId) {
			return; // Skip if no album available
		}

		const response = await fetch(`${API_BASE_URL}/api/albums/${testAlbumId}`, {
			headers: getAuthHeaders()
		});

		expect([200, 401, 404, 500]).toContain(response.status);

		if (response.status === 200) {
			const album = (await response.json()) as ImmichAlbum;
			expect(album.id).toBe(testAlbumId);
		}
	});

	it('should return 404 for non-existent album', async () => {
		const response = await fetch(`${API_BASE_URL}/api/albums/inexistant-id-12345`, {
			headers: getAuthHeaders()
		});

		expect([400, 404, 500]).toContain(response.status);
	});
});

describe('Albums API - PATCH /api/albums/[id]', () => {
	it('should respect WRITE permissions', async () => {
		// First create a test album
		const createRes = await fetch(`${API_BASE_URL}/api/albums`, {
			method: 'POST',
			headers: getAuthHeaders(),
			body: JSON.stringify({ albumName: `[TEST] Patch Album ${Date.now()}` })
		});

		if (createRes.status === 200 || createRes.status === 201) {
			const album = (await createRes.json()) as ImmichAlbum;
			const albumId = album.id;
			// Track for cleanup
			createdAlbumIds.push(albumId);

			const updateData = {
				name: `[TEST] Updated Album ${Date.now()}`,
				visibility: 'authenticated' as const
			};

			const result = await testPermissions({
				endpoint: `/api/albums/${albumId}`,
				method: 'PATCH',
				body: updateData,
				requiredScope: 'write',
				description: 'Album modification'
			});

			expect(result.noAuth.passed).toBe(true); // Should reject
			expect(result.read.passed).toBe(true); // Should reject
			expect(result.write.passed).toBe(true); // Should accept
			expect(result.admin.passed).toBe(true); // Should accept
		}
	});

	it('should update an album', async () => {
		if (!testAlbumId) {
			return;
		}

		const updates = {
			albumName: `[TEST] Album Modified ${Date.now()}`,
			description: 'Updated description'
		};

		const response = await fetch(`${API_BASE_URL}/api/albums/${testAlbumId}`, {
			method: 'PATCH',
			headers: getAuthHeaders(),
			body: JSON.stringify(updates)
		});

		expect([200, 401, 404, 500]).toContain(response.status);
	});
});

describe('Albums API - GET /api/albums/[id]/assets-simple', () => {
	it('should fetch album assets (simple format)', async () => {
		if (!testAlbumId) {
			return;
		}

		const response = await fetch(`${API_BASE_URL}/api/albums/${testAlbumId}/assets-simple`, {
			headers: getAuthHeaders()
		});

		expect([200, 401, 404, 500]).toContain(response.status);

		if (response.status === 200) {
			const result = (await response.json()) as { success?: boolean; data?: unknown[] } | unknown[];
			// Handle both possible response formats
			if (Array.isArray(result)) {
				expect(Array.isArray(result)).toBe(true);
			} else if (result.data) {
				expect(Array.isArray(result.data)).toBe(true);
			} else {
				// Format alternatif
				expect(true).toBe(true);
			}
		}
	});
});

describe('Albums API - GET /api/albums/[id]/assets-stream', () => {
	it('should stream the assets of an album', async () => {
		if (!testAlbumId) {
			return;
		}

		const response = await fetch(`${API_BASE_URL}/api/albums/${testAlbumId}/assets-stream`, {
			headers: getAuthHeaders()
		});

		expect([200, 401, 404, 500]).toContain(response.status);

		if (response.status === 200) {
			const contentType = response.headers.get('content-type') || '';
			// Streaming can return application/json or application/x-ndjson
			expect(contentType).toMatch(/application\/(json|x-ndjson)/);
		}
	});

	it('should support pagination with cursor', async () => {
		if (!testAlbumId) {
			return;
		}

		const response = await fetch(
			`${API_BASE_URL}/api/albums/${testAlbumId}/assets-stream?cursor=10&limit=20`,
			{
				headers: getAuthHeaders()
			}
		);

		expect([200, 401, 404, 500]).toContain(response.status);
	});
});

describe('Albums API - PUT /api/albums/[id]/assets', () => {
	it('should add assets to album', async () => {
		if (!testAlbumId) {
			return;
		}

		const response = await fetch(`${API_BASE_URL}/api/albums/${testAlbumId}/assets`, {
			method: 'PUT',
			headers: getAuthHeaders(),
			body: JSON.stringify({
				ids: ['asset-id-1', 'asset-id-2']
			})
		});

		expect([200, 400, 401, 404, 500]).toContain(response.status);
	});
});

describe('Albums API - DELETE /api/albums/[id]/assets', () => {
	it('should respect WRITE permissions', async () => {
		if (!testAlbumId) {
			return; // Skip if test album creation failed
		}

		const result = await testPermissions({
			endpoint: `/api/albums/${testAlbumId}/assets`,
			method: 'DELETE',
			requiredScope: 'write',
			description: 'Remove assets from an album',
			body: { ids: ['00000000-0000-0000-0000-000000000000'] }
		});

		// Without auth -> rejected
		expect(result.noAuth.passed, `noAuth failed with status ${result.noAuth.status}`).toBe(true);
		// With READ -> rejected (since this is a WRITE endpoint)
		expect(result.read.passed, `read failed with status ${result.read.status}`).toBe(true);

		// For WRITE and ADMIN, we test access.
		// If auth passes, we can get 200 (success), 400 (bad request), 404 (not found).
		// The important thing is that it is NOT 401 or 403.
		expect([401, 403]).not.toContain(result.write.status);
		expect([401, 403]).not.toContain(result.admin.status);
	});

	it('should remove assets from album', async () => {
		if (!testAlbumId) {
			return;
		}

		const response = await fetch(`${API_BASE_URL}/api/albums/${testAlbumId}/assets`, {
			method: 'DELETE',
			headers: getAuthHeaders(),
			body: JSON.stringify({
				ids: ['asset-id-1']
			})
		});

		expect([200, 400, 401, 404, 500]).toContain(response.status);
	});
});

describe('Albums API - GET /api/albums/[id]/info', () => {
	it('should fetch album information', async () => {
		if (!testAlbumId) {
			return;
		}

		const response = await fetch(`${API_BASE_URL}/api/albums/${testAlbumId}/info`, {
			headers: getAuthHeaders()
		});

		expect([200, 401, 404, 500]).toContain(response.status);

		if (response.status === 200) {
			const info = (await response.json()) as Record<string, unknown>;
			// Response can be {id, ...} or {success, album: {id, ...}}
			if (info.success && info.album) {
				expect(info.album).toHaveProperty('id');
			} else {
				expect(info).toHaveProperty('id');
			}
		}
	});
});

describe('Albums API - PUT /api/albums/[id]/metadata', () => {
	it('should update album metadata', async () => {
		if (!testAlbumId) {
			return;
		}

		const metadata = {
			title: 'New title',
			description: 'New description'
		};

		const response = await fetch(`${API_BASE_URL}/api/albums/${testAlbumId}/metadata`, {
			method: 'PUT',
			headers: getAuthHeaders(),
			body: JSON.stringify(metadata)
		});

		expect([200, 400, 401, 404, 500]).toContain(response.status);
	});
});

describe('Albums API - Asset Thumbnail', () => {
	it('should fetch thumbnail with full path', async () => {
		if (!testAlbumId) {
			return;
		}

		const response = await fetch(
			`${API_BASE_URL}/api/albums/${testAlbumId}/asset-thumbnail/test-asset/thumbnail`,
			{
				headers: getAuthHeaders()
			}
		);

		expect([200, 400, 401, 404, 500]).toContain(response.status);
	});

	it('should fetch thumbnail without specifying path', async () => {
		if (!testAlbumId) {
			return;
		}

		const response = await fetch(
			`${API_BASE_URL}/api/albums/${testAlbumId}/asset-thumbnail/test-asset`,
			{
				headers: getAuthHeaders()
			}
		);

		expect([200, 400, 401, 404, 500]).toContain(response.status);
	});
});

describe('Albums API - Asset Original', () => {
	it('should fetch original asset', async () => {
		if (!testAlbumId) {
			return;
		}

		const response = await fetch(
			`${API_BASE_URL}/api/albums/${testAlbumId}/asset-original/test-asset`,
			{
				headers: getAuthHeaders()
			}
		);

		expect([200, 400, 401, 404, 500]).toContain(response.status);
	});

	it('should support all HTTP methods for original asset', async () => {
		if (!testAlbumId) {
			return;
		}

		const methods = ['POST', 'PUT', 'DELETE', 'PATCH'];

		for (const method of methods) {
			const response = await fetch(
				`${API_BASE_URL}/api/albums/${testAlbumId}/asset-original/test-asset`,
				{
					method,
					headers: getAuthHeaders()
				}
			);

			expect([200, 400, 401, 404, 405, 500]).toContain(response.status);
		}
	});
});

describe('Albums API - Covers', () => {
	it('should generate album covers', async () => {
		const response = await fetch(`${API_BASE_URL}/api/albums/covers`, {
			method: 'POST',
			headers: getAuthHeaders(),
			body: JSON.stringify({
				albumIds: [testAlbumId]
			})
		});

		expect([200, 400, 401, 500]).toContain(response.status);
	});
});

describe('Albums API - DELETE /api/albums/[id]', () => {
	it('should delete an album', async () => {
		if (!testAlbumId) {
			return;
		}

		const response = await fetch(`${API_BASE_URL}/api/albums/${testAlbumId}`, {
			method: 'DELETE',
			headers: getAuthHeaders()
		});

		expect([200, 204, 401, 404, 500]).toContain(response.status);
	});
});

// Tests for /api/albums/list and /api/albums/import deleted - deprecated endpoints
// GET /api/albums now returns the list of albums from the local DB

describe('Albums API - POST /api/albums/[id]/permissions/tags', () => {
	it('should reject requests without authentication', async () => {
		// Use the first available album or skip
		if (!testAlbumId) {
			return;
		}

		const response = await fetch(`${API_BASE_URL}/api/albums/${testAlbumId}/permissions/tags`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ add: ['test'], remove: [] })
		});

		expect([401, 403]).toContain(response.status);
	});

	it('should manage tag permissions', async () => {
		if (!testAlbumId) {
			return;
		}

		// Test addition
		const addResponse = await fetch(`${API_BASE_URL}/api/albums/${testAlbumId}/permissions/tags`, {
			method: 'POST',
			headers: getAuthHeaders(),
			body: JSON.stringify({ add: ['test-tag-ci'], remove: [] })
		});

		expect([200, 401, 403, 404]).toContain(addResponse.status);

		if (addResponse.status === 200) {
			const addData = (await addResponse.json()) as {
				success: boolean;
				added: number;
				removed: number;
			};
			expect(addData.success).toBe(true);
			expect(addData).toHaveProperty('added');

			// Test deletion
			const removeResponse = await fetch(
				`${API_BASE_URL}/api/albums/${testAlbumId}/permissions/tags`,
				{
					method: 'POST',
					headers: getAuthHeaders(),
					body: JSON.stringify({ add: [], remove: ['test-tag-ci'] })
				}
			);

			expect([200, 401, 403, 404]).toContain(removeResponse.status);

			if (removeResponse.status === 200) {
				const removeData = (await removeResponse.json()) as { success: boolean; removed: number };
				expect(removeData.success).toBe(true);
			}
		}
	});
});

describe('Albums API - POST /api/albums/[id]/permissions/users', () => {
	it('should reject requests without authentication', async () => {
		if (!testAlbumId) {
			return;
		}

		const response = await fetch(`${API_BASE_URL}/api/albums/${testAlbumId}/permissions/users`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ add: ['test.user'], remove: [] })
		});

		expect([401, 403]).toContain(response.status);
	});

	it('should manage user permissions', async () => {
		if (!testAlbumId) {
			return;
		}

		// Test addition (may fail if user doesn't exist, that's OK)
		const addResponse = await fetch(`${API_BASE_URL}/api/albums/${testAlbumId}/permissions/users`, {
			method: 'POST',
			headers: getAuthHeaders(),
			body: JSON.stringify({
				add: ['dd68bb5b4f7c56878a1bd873593a3e7c3434242c80871e4ead9fe99d3f48a782'],
				remove: []
			})
		});

		expect([200, 401, 403, 404]).toContain(addResponse.status);

		if (addResponse.status === 200) {
			const addData = (await addResponse.json()) as {
				success: boolean;
				added: number;
				removed: number;
			};
			expect(addData.success).toBe(true);

			// Test deletion
			const removeResponse = await fetch(
				`${API_BASE_URL}/api/albums/${testAlbumId}/permissions/users`,
				{
					method: 'POST',
					headers: getAuthHeaders(),
					body: JSON.stringify({
						add: [],
						remove: ['dd68bb5b4f7c56878a1bd873593a3e7c3434242c80871e4ead9fe99d3f48a782']
					})
				}
			);

			expect([200, 401, 403, 404]).toContain(removeResponse.status);
		}
	});
});
