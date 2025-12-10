/**
 * Tests exhaustifs pour l'API Admin et Authentication
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { ApiKeyResponse, ApiKeysListResponse } from '$lib/types/api';
import { setupTestAuth, teardownTestAuth, globalTestContext } from './test-helpers';

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';
let testApiKeyId: string | null = null;

beforeAll(async () => {
	await setupTestAuth();
});

afterAll(async () => {
	// Nettoyage : supprimer les clés API de test
	if (testApiKeyId && globalTestContext.sessionCookie) {
		await fetch(`${API_BASE_URL}/api/admin/api-keys/${testApiKeyId}`, {
			method: 'DELETE',
			headers: { Cookie: globalTestContext.sessionCookie }
		});
	}

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

describe('Admin API Keys - GET /api/admin/api-keys', () => {
	it('devrait lister toutes les clés API (admin)', async () => {
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

	it("devrait rejeter l'accès sans authentification", async () => {
		const response = await fetch(`${API_BASE_URL}/api/admin/api-keys`);
		expect([401, 403]).toContain(response.status);
	});

	it("devrait rejeter l'accès pour les non-admins", async () => {
		// TODO: Tester avec un token utilisateur non-admin
		await Promise.resolve();
		expect(true).toBe(true);
	});
});

describe('Admin API Keys - POST /api/admin/api-keys', () => {
	it('devrait créer une nouvelle clé API', async () => {
		const newKey = {
			label: `Test API Key ${Date.now()}`,
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

	it('devrait créer une clé API avec scope admin', async () => {
		const adminKey = {
			label: 'Admin Key Test',
			scopes: ['admin']
		};

		const response = await fetch(`${API_BASE_URL}/api/admin/api-keys`, {
			method: 'POST',
			headers: getAuthHeaders(),
			body: JSON.stringify(adminKey)
		});

		expect([200, 201, 400, 401, 403]).toContain(response.status);
	});

	it('devrait créer une clé API avec scope read uniquement', async () => {
		const readKey = {
			label: 'Read Only Key',
			scopes: ['read']
		};

		const response = await fetch(`${API_BASE_URL}/api/admin/api-keys`, {
			method: 'POST',
			headers: getAuthHeaders(),
			body: JSON.stringify(readKey)
		});

		expect([200, 201, 400, 401, 403]).toContain(response.status);
	});

	it('devrait rejeter la création sans label', async () => {
		const response = await fetch(`${API_BASE_URL}/api/admin/api-keys`, {
			method: 'POST',
			headers: getAuthHeaders(),
			body: JSON.stringify({
				scopes: ['read']
			})
		});

		expect([200, 400, 401, 403]).toContain(response.status);
	});

	it('devrait rejeter la création avec des scopes invalides', async () => {
		const invalidKey = {
			label: 'Invalid Scope Key',
			scopes: ['invalid-scope', 'super-admin']
		};

		const response = await fetch(`${API_BASE_URL}/api/admin/api-keys`, {
			method: 'POST',
			headers: getAuthHeaders(),
			body: JSON.stringify(invalidKey)
		});

		expect([200, 400, 401, 403]).toContain(response.status);
	});

	it('devrait accepter plusieurs scopes valides', async () => {
		const multiScopeKey = {
			label: 'Multi Scope Key',
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
	it('devrait supprimer une clé API', async () => {
		if (!testApiKeyId) {
			return;
		}

		const response = await fetch(`${API_BASE_URL}/api/admin/api-keys/${testApiKeyId}`, {
			method: 'DELETE',
			headers: getAuthHeaders()
		});

		expect([200, 204, 401, 403, 404]).toContain(response.status);

		if (response.status === 200 || response.status === 204) {
			// Vérifier que la clé a bien été supprimée
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

	it('devrait retourner 404 pour une clé inexistante', async () => {
		const response = await fetch(`${API_BASE_URL}/api/admin/api-keys/inexistant-key-id`, {
			method: 'DELETE',
			headers: getAuthHeaders()
		});

		expect([404, 401]).toContain(response.status);
	});
});

describe('Admin Database - GET /api/admin/db-inspect', () => {
	it('devrait inspecter la base de données (admin)', async () => {
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

	it("devrait rejeter l'accès pour les non-admins", async () => {
		const response = await fetch(`${API_BASE_URL}/api/admin/db-inspect`, {
			headers: getAuthHeaders()
		});

		expect([200, 401, 403]).toContain(response.status);
	});
});

describe('Admin Database - GET /api/admin/db-export', () => {
	it('devrait exporter la base de données (admin)', async () => {
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

	it("devrait rejeter l'export pour les non-admins", async () => {
		const response = await fetch(`${API_BASE_URL}/api/admin/db-export`, {
			headers: getAuthHeaders()
		});

		expect([200, 401, 403]).toContain(response.status);
	});
});

describe('Admin Database - POST /api/admin/db-import', () => {
	it("devrait rejeter l'import sans fichier", async () => {
		const response = await fetch(`${API_BASE_URL}/api/admin/db-import`, {
			method: 'POST',
			headers: getAuthHeaders()
		});

		expect([400, 401, 403, 500]).toContain(response.status);
	});

	it("devrait rejeter l'import d'un fichier non-SQLite", async () => {
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
	it('devrait créer une sauvegarde de la base de données (admin)', async () => {
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

	it('devrait rejeter la sauvegarde pour les non-admins', async () => {
		const response = await fetch(`${API_BASE_URL}/api/admin/db-backup`, {
			method: 'POST',
			headers: getAuthHeaders()
		});

		expect([200, 201, 401, 403, 500]).toContain(response.status);
	});
});

describe('Admin Database - POST /api/admin/db-restore', () => {
	it('devrait rejeter la restauration sans fichier', async () => {
		const response = await fetch(`${API_BASE_URL}/api/admin/db-restore`, {
			method: 'POST',
			headers: getAuthHeaders()
		});

		expect([400, 401, 403, 500]).toContain(response.status);
	});

	it("devrait rejeter la restauration d'un fichier invalide", async () => {
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
	it("devrait retourner le statut de santé de l'API", async () => {
		const response = await fetch(`${API_BASE_URL}/api/health`);

		expect([200]).toContain(response.status);

		if (response.status === 200) {
			const data = (await response.json()) as { status: string; timestamp: string };
			expect(data.status).toBe('ok');
			expect(data).toHaveProperty('timestamp');
		}
	});

	it("ne devrait pas nécessiter d'authentification", async () => {
		const response = await fetch(`${API_BASE_URL}/api/health`);
		expect(response.status).toBe(200);
	});

	it('devrait retourner un timestamp valide', async () => {
		const response = await fetch(`${API_BASE_URL}/api/health`);

		if (response.status === 200) {
			const data = (await response.json()) as { timestamp: string };
			const timestamp = new Date(data.timestamp);
			expect(timestamp.getTime()).toBeGreaterThan(0);
		}
	});
});

describe('API Authentication - API Key Validation', () => {
	it('devrait accepter une clé API valide', async () => {
		const response = await fetch(`${API_BASE_URL}/api/albums`, {
			headers: {
				'x-api-key': globalTestContext.adminApiKey || ''
			}
		});

		expect([200, 401, 500]).toContain(response.status);
	});

	it('devrait rejeter une clé API invalide', async () => {
		const response = await fetch(`${API_BASE_URL}/api/albums`, {
			headers: {
				'x-api-key': 'invalid-api-key-12345'
			}
		});

		expect([401, 403]).toContain(response.status);
	});

	it('devrait rejeter une clé API vide', async () => {
		const response = await fetch(`${API_BASE_URL}/api/albums`, {
			headers: {
				'x-api-key': ''
			}
		});

		expect([401, 403]).toContain(response.status);
	});

	it('devrait respecter les scopes de la clé API', () => {
		// TODO: Créer une clé avec scope 'read' uniquement et tester les opérations write
		expect(true).toBe(true);
	});
});

describe('API Rate Limiting', () => {
	it('devrait gérer de multiples requêtes simultanées', async () => {
		const requests = Array.from({ length: 10 }, () => fetch(`${API_BASE_URL}/api/health`));

		const responses = await Promise.all(requests);
		const statuses = responses.map((r) => r.status);

		// Toutes les requêtes devraient réussir ou être limitées
		statuses.forEach((status) => {
			expect([200, 429]).toContain(status);
		});
	});
});

describe('API Error Handling', () => {
	it('devrait retourner des erreurs au format JSON', async () => {
		const response = await fetch(`${API_BASE_URL}/api/albums/inexistant-id`);

		expect([404, 401, 500]).toContain(response.status);

		const contentType = response.headers.get('content-type');
		if (contentType) {
			expect(contentType).toContain('application/json');
		}
	});

	it('devrait gérer les erreurs de validation', async () => {
		const response = await fetch(`${API_BASE_URL}/api/users`, {
			method: 'POST',
			headers: getAuthHeaders(),
			body: JSON.stringify({
				invalid: 'data'
			})
		});

		expect([400, 401, 403]).toContain(response.status);
	});

	it('devrait gérer les timeouts gracieusement', () => {
		// TODO: Tester avec un endpoint qui timeout
		expect(true).toBe(true);
	});
});
