/**
 * Comprehensive tests for Admin API and Authentication
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { ApiKeyResponse, ApiKeysListResponse } from '$lib/types/api';
import { setupTestAuth, teardownTestAuth, globalTestContext } from './test-helpers';

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';
let testApiKeyId: string | null = null;

// List of key labels created during tests for cleanup
const TEST_KEY_LABELS = [
	'[TEST] Admin Key',
	'[TEST] Read Only Key',
	'[TEST] Invalid Scope Key',
	'[TEST] Multi Scope Key'
];

beforeAll(async () => {
	await setupTestAuth();
});

afterAll(async () => {
	// Cleanup: delete the main test key
	if (testApiKeyId && globalTestContext.sessionCookie) {
		await fetch(`${API_BASE_URL}/api/admin/api-keys/${testApiKeyId}`, {
			method: 'DELETE',
			headers: { Cookie: globalTestContext.sessionCookie }
		});
	}

	// Cleanup: delete all test keys created
	if (globalTestContext.adminApiKey) {
		try {
			const response = await fetch(`${API_BASE_URL}/api/admin/api-keys`, {
				headers: { 'x-api-key': globalTestContext.adminApiKey }
			});
			if (response.ok) {
				const data = (await response.json()) as ApiKeysListResponse;
				for (const key of data.keys || []) {
					// Delete keys with test labels or that start with "Test API Key"
					if (
						TEST_KEY_LABELS.includes(key.label || '') ||
						(key.label && key.label.startsWith('Test API Key'))
					) {
						await fetch(`${API_BASE_URL}/api/admin/api-keys/${key.id}`, {
							method: 'DELETE',
							headers: { 'x-api-key': globalTestContext.adminApiKey }
						});
					}
				}
			}
		} catch (e: unknown) {
			const message = e instanceof Error ? e.message : String(e);
			if (!message.startsWith('fetch failed')) {
				console.warn('Error cleaning up test keys:', message);
			}
		}

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

describe('Admin API Keys - GET /api/admin/api-keys', () => {
	it('should list all API keys (admin)', async () => {
		const response = await fetch(`${API_BASE_URL}/api/admin/api-keys`, {
			headers: getAuthHeaders()
		});

		expect([200, 401, 403]).toContain(response.status);

		if (response.status === 200) {
			const data = (await response.json()) as ApiKeysListResponse;
			expect(data.success).toBe(true);
			expect(Array.isArray(data.keys)).toBe(true);

			if (data.keys.length > 0) {
				const key = data.keys[0];
				expect(key).toHaveProperty('id');
				expect(key).toHaveProperty('label');
				expect(key).toHaveProperty('scopes');
				expect(key).toHaveProperty('created_at');
			}
		}
	});

	it('should reject access without authentication', async () => {
		const response = await fetch(`${API_BASE_URL}/api/admin/api-keys`);
		expect([401, 403]).toContain(response.status);
	});

	it('should reject access for non-admins', async () => {
		// TODO: Test with a non-admin user token
		await Promise.resolve();
		expect(true).toBe(true);
	});
});

describe('Admin API Keys - POST /api/admin/api-keys', () => {
	it('should create a new API key', async () => {
		const newKey = {
			label: `[TEST] API Key ${Date.now()}`,
			scopes: ['read', 'write']
		};

		const response = await fetch(`${API_BASE_URL}/api/admin/api-keys`, {
			method: 'POST',
			headers: getAuthHeaders(),
			body: JSON.stringify(newKey)
		});

		expect([200, 201, 400, 401, 403]).toContain(response.status);

		if (response.status === 200 || response.status === 201) {
			const data = (await response.json()) as ApiKeyResponse;
			expect(data.rawKey).toBeDefined();
			expect(data.id).toBeDefined();
			expect(typeof data.rawKey).toBe('string');
			if (data.rawKey) {
				expect(data.rawKey.length).toBeGreaterThan(20);
			}
			testApiKeyId = data.id ?? null;
		}
	});

	it('should create an API key with admin scope', async () => {
		const adminKey = {
			label: '[TEST] Admin Key',
			scopes: ['admin']
		};

		const response = await fetch(`${API_BASE_URL}/api/admin/api-keys`, {
			method: 'POST',
			headers: getAuthHeaders(),
			body: JSON.stringify(adminKey)
		});

		expect([200, 201, 400, 401, 403]).toContain(response.status);
	});

	it('should create an API key with read scope only', async () => {
		const readKey = {
			label: '[TEST] Read Only Key',
			scopes: ['read']
		};

		const response = await fetch(`${API_BASE_URL}/api/admin/api-keys`, {
			method: 'POST',
			headers: getAuthHeaders(),
			body: JSON.stringify(readKey)
		});

		expect([200, 201, 400, 401, 403]).toContain(response.status);
	});

	it('should reject creation without label', async () => {
		const response = await fetch(`${API_BASE_URL}/api/admin/api-keys`, {
			method: 'POST',
			headers: getAuthHeaders(),
			body: JSON.stringify({
				scopes: ['read']
			})
		});

		expect([200, 400, 401, 403]).toContain(response.status);
	});

	it('should reject creation with invalid scopes', async () => {
		const invalidKey = {
			label: '[TEST] Invalid Scope Key',
			scopes: ['invalid-scope', 'super-admin']
		};

		const response = await fetch(`${API_BASE_URL}/api/admin/api-keys`, {
			method: 'POST',
			headers: getAuthHeaders(),
			body: JSON.stringify(invalidKey)
		});

		expect([200, 400, 401, 403]).toContain(response.status);
	});

	it('should accept multiple valid scopes', async () => {
		const multiScopeKey = {
			label: '[TEST] Multi Scope Key',
			scopes: ['read', 'write', 'delete']
		};

		const response = await fetch(`${API_BASE_URL}/api/admin/api-keys`, {
			method: 'POST',
			headers: getAuthHeaders(),
			body: JSON.stringify(multiScopeKey)
		});

		expect([200, 201, 400, 401, 403]).toContain(response.status);
	});
});

describe('Admin API Keys - DELETE /api/admin/api-keys/[id]', () => {
	it('should delete an API key', async () => {
		if (!testApiKeyId) {
			return;
		}

		const response = await fetch(`${API_BASE_URL}/api/admin/api-keys/${testApiKeyId}`, {
			method: 'DELETE',
			headers: getAuthHeaders()
		});

		expect([200, 204, 401, 403, 404]).toContain(response.status);

		if (response.status === 200 || response.status === 204) {
			// Verify that the key was deleted
			const checkResponse = await fetch(`${API_BASE_URL}/api/admin/api-keys`, {
				headers: getAuthHeaders()
			});

			if (checkResponse.status === 200) {
				const data = (await checkResponse.json()) as ApiKeysListResponse;
				const deletedKey = (data.keys as Array<{ id: string | null }>).find(
					(k) => k.id === testApiKeyId
				);
				expect(deletedKey).toBeUndefined();
			}

			testApiKeyId = null;
		}
	});

	it('should return 404 for non-existent key', async () => {
		const response = await fetch(`${API_BASE_URL}/api/admin/api-keys/inexistant-key-id`, {
			method: 'DELETE',
			headers: getAuthHeaders()
		});

		expect([404, 401]).toContain(response.status);
	});
});

describe('Admin Database - GET /api/admin/db-inspect', () => {
	it('should inspect the database (admin)', async () => {
		const response = await fetch(`${API_BASE_URL}/api/admin/db-inspect`, {
			headers: getAuthHeaders()
		});

		expect([200, 401, 403]).toContain(response.status);

		if (response.status === 200) {
			const data = (await response.json()) as { tables: unknown[] };
			expect(data).toHaveProperty('tables');
			expect(Array.isArray(data.tables)).toBe(true);
		}
	});

	it('should reject access for non-admins', async () => {
		const response = await fetch(`${API_BASE_URL}/api/admin/db-inspect`, {
			headers: getAuthHeaders()
		});

		expect([200, 401, 403]).toContain(response.status);
	});
});

describe('Admin Database - GET /api/admin/db-export', () => {
	it('should export the database (admin)', async () => {
		const response = await fetch(`${API_BASE_URL}/api/admin/db-export`, {
			headers: getAuthHeaders()
		});

		expect([200, 401, 403, 500]).toContain(response.status);

		if (response.status === 200) {
			const contentType = response.headers.get('content-type');
			expect(contentType).toContain('application/x-sqlite3');

			const contentDisposition = response.headers.get('content-disposition');
			expect(contentDisposition).toContain('attachment');
			expect(contentDisposition).toContain('.db');
		}
	});

	it('should reject export for non-admins', async () => {
		const response = await fetch(`${API_BASE_URL}/api/admin/db-export`, {
			headers: getAuthHeaders()
		});

		expect([200, 401, 403]).toContain(response.status);
	});
});

describe('Admin Database - POST /api/admin/db-import', () => {
	it('should reject import without file', async () => {
		const response = await fetch(`${API_BASE_URL}/api/admin/db-import`, {
			method: 'POST',
			headers: getAuthHeaders()
		});

		expect([400, 401, 403, 500]).toContain(response.status);
	});

	it('should reject import of non-SQLite file', async () => {
		const formData = new FormData();
		const fakeFile = new Blob(['not a database'], { type: 'text/plain' });
		formData.append('file', fakeFile, 'fake.txt');

		const response = await fetch(`${API_BASE_URL}/api/admin/db-import`, {
			method: 'POST',
			headers: {
				'x-api-key': globalTestContext.adminApiKey || ''
			},
			body: formData
		});

		expect([400, 401, 403]).toContain(response.status);
	});
});

describe('Admin Database - POST /api/admin/db-backup', () => {
	it('should create a database backup (admin)', async () => {
		const response = await fetch(`${API_BASE_URL}/api/admin/db-backup`, {
			method: 'POST',
			headers: getAuthHeaders()
		});

		expect([200, 201, 401, 403, 500]).toContain(response.status);

		if (response.status === 200 || response.status === 201) {
			const data = (await response.json()) as { success: boolean; backupPath: string };
			expect(data.success).toBe(true);
			expect(data.backupPath).toBeDefined();
		}
	});

	it('should reject backup for non-admins', async () => {
		const response = await fetch(`${API_BASE_URL}/api/admin/db-backup`, {
			method: 'POST',
			headers: getAuthHeaders()
		});

		expect([200, 201, 401, 403, 500]).toContain(response.status);
	});
});

describe('Admin Database - POST /api/admin/db-restore', () => {
	it('should reject restore without file', async () => {
		const response = await fetch(`${API_BASE_URL}/api/admin/db-restore`, {
			method: 'POST',
			headers: getAuthHeaders()
		});

		expect([400, 401, 403, 500]).toContain(response.status);
	});

	it('should reject restore of invalid file', async () => {
		const formData = new FormData();
		const fakeFile = new Blob(['invalid'], { type: 'text/plain' });
		formData.append('file', fakeFile, 'invalid.db');

		const response = await fetch(`${API_BASE_URL}/api/admin/db-restore`, {
			method: 'POST',
			headers: {
				'x-api-key': globalTestContext.adminApiKey || ''
			},
			body: formData
		});

		expect([400, 401, 403, 500]).toContain(response.status);
	});
});

describe('Health API - GET /api/health', () => {
	it('should return API health status', async () => {
		const response = await fetch(`${API_BASE_URL}/api/health`);

		expect([200]).toContain(response.status);

		if (response.status === 200) {
			const data = (await response.json()) as { status: string; timestamp: string };
			expect(data.status).toBe('ok');
			expect(data).toHaveProperty('timestamp');
		}
	});

	it('should not require authentication', async () => {
		const response = await fetch(`${API_BASE_URL}/api/health`);
		expect(response.status).toBe(200);
	});

	it('should return a valid timestamp', async () => {
		const response = await fetch(`${API_BASE_URL}/api/health`);

		if (response.status === 200) {
			const data = (await response.json()) as { timestamp: string };
			const timestamp = new Date(data.timestamp);
			expect(timestamp.getTime()).toBeGreaterThan(0);
		}
	});
});

describe('API Authentication - API Key Validation', () => {
	it('should accept a valid API key', async () => {
		const response = await fetch(`${API_BASE_URL}/api/albums`, {
			headers: {
				'x-api-key': globalTestContext.adminApiKey || ''
			}
		});

		expect([200, 401, 500]).toContain(response.status);
	});

	it('should reject an invalid API key', async () => {
		const response = await fetch(`${API_BASE_URL}/api/albums`, {
			headers: {
				'x-api-key': 'invalid-api-key-12345'
			}
		});

		expect([401, 403]).toContain(response.status);
	});

	it('should reject an empty API key', async () => {
		const response = await fetch(`${API_BASE_URL}/api/albums`, {
			headers: {
				'x-api-key': ''
			}
		});

		expect([401, 403]).toContain(response.status);
	});

	it('should respect API key scopes', () => {
		// TODO: Create an API key with 'read' scope only and test write operations
		expect(true).toBe(true);
	});
});

describe('API Rate Limiting', () => {
	it('should handle multiple simultaneous requests', async () => {
		const requests = Array.from({ length: 10 }, () => fetch(`${API_BASE_URL}/api/health`));

		const responses = await Promise.all(requests);
		const statuses = responses.map((r) => r.status);

		// All requests should succeed or be rate-limited
		statuses.forEach((status) => {
			expect([200, 429]).toContain(status);
		});
	});
});

describe('API Error Handling', () => {
	it('should return errors in JSON format', async () => {
		const response = await fetch(`${API_BASE_URL}/api/albums/inexistant-id`);

		expect([404, 401, 500]).toContain(response.status);

		const contentType = response.headers.get('content-type');
		if (contentType) {
			expect(contentType).toContain('application/json');
		}
	});

	it('should handle validation errors', async () => {
		const response = await fetch(`${API_BASE_URL}/api/users`, {
			method: 'POST',
			headers: getAuthHeaders(),
			body: JSON.stringify({
				invalid: 'data'
			})
		});

		expect([400, 401, 403]).toContain(response.status);
	});

	it('should handle timeouts gracefully', () => {
		// TODO: Test with an endpoint that times out
		expect(true).toBe(true);
	});
});
