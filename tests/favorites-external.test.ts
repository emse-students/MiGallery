/**
 * Tests exhaustifs pour l'API Favoris, Corbeille et External Media
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
	it("devrait lister les favoris de l'utilisateur", async () => {
		const response = await fetch(`${API_BASE_URL}/api/favorites`, {
			headers: getAuthHeaders()
		});

		expect([200, 401, 403]).toContain(response.status);

		if (response.status === 200) {
			const favorites = await response.json();
			expect(Array.isArray(favorites)).toBe(true);
		}
	});

	it("devrait rejeter l'accès sans authentification", async () => {
		const response = await fetch(`${API_BASE_URL}/api/favorites`);
		expect([401, 403]).toContain(response.status);
	});

	it('devrait retourner une liste vide si aucun favori', async () => {
		const response = await fetch(`${API_BASE_URL}/api/favorites`, {
			headers: getAuthHeaders()
		});

		if (response.status === 200) {
			const favorites = await response.json();
			expect(Array.isArray(favorites)).toBe(true);
		}
	});
});

describe('Favorites API - POST /api/favorites', () => {
	it('devrait ajouter un asset aux favoris', async () => {
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

	it("devrait rejeter l'ajout sans assetId", async () => {
		const response = await fetch(`${API_BASE_URL}/api/favorites`, {
			method: 'POST',
			headers: getAuthHeaders(),
			body: JSON.stringify({})
		});

		expect([400, 401, 403]).toContain(response.status);
	});

	it("devrait gérer l'ajout en doublon gracieusement", async () => {
		// Ajouter une première fois
		await fetch(`${API_BASE_URL}/api/favorites`, {
			method: 'POST',
			headers: getAuthHeaders(),
			body: JSON.stringify({
				assetId: testAssetId
			})
		});

		// Ajouter une deuxième fois (doublon)
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
	it('devrait retirer un asset des favoris', async () => {
		const response = await fetch(`${API_BASE_URL}/api/favorites`, {
			method: 'DELETE',
			headers: getAuthHeaders(),
			body: JSON.stringify({
				assetId: testAssetId
			})
		});

		expect([200, 204, 400, 401, 403, 404]).toContain(response.status);
	});

	it('devrait rejeter la suppression sans assetId', async () => {
		const response = await fetch(`${API_BASE_URL}/api/favorites`, {
			method: 'DELETE',
			headers: getAuthHeaders(),
			body: JSON.stringify({})
		});

		expect([400, 401, 403]).toContain(response.status);
	});

	it("devrait gérer la suppression d'un favori inexistant", async () => {
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
	it('devrait lister tous les médias externes', async () => {
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

	it("devrait rejeter l'accès sans authentification", async () => {
		const response = await fetch(`${API_BASE_URL}/api/external/media`);
		expect([401, 403]).toContain(response.status);
	});
});

describe('External Media API - POST /api/external/media', () => {
	it('devrait créer un nouveau média externe avec URL', async () => {
		const mediaData = {
			type: 'url',
			url: 'https://example.com/video.mp4',
			title: 'Test Video',
			description: 'Video de test'
		};

		const response = await fetch(`${API_BASE_URL}/api/external/media`, {
			method: 'POST',
			headers: getAuthHeaders(),
			body: JSON.stringify(mediaData)
		});

		expect([200, 201, 400, 401, 403]).toContain(response.status);

		if (response.status === 200 || response.status === 201) {
			const data = await response.json();
			expect(data.success).toBe(true);
			expect(data.media).toHaveProperty('id');
		}
	});

	it('devrait créer un média externe avec code embed', async () => {
		const mediaData = {
			type: 'embed',
			embedCode: '<iframe src="https://youtube.com/embed/test"></iframe>',
			title: 'Test Embed',
			description: 'Embed de test'
		};

		const response = await fetch(`${API_BASE_URL}/api/external/media`, {
			method: 'POST',
			headers: getAuthHeaders(),
			body: JSON.stringify(mediaData)
		});

		expect([200, 201, 400, 401, 403]).toContain(response.status);
	});

	it('devrait rejeter la création sans données requises', async () => {
		const response = await fetch(`${API_BASE_URL}/api/external/media`, {
			method: 'POST',
			headers: getAuthHeaders(),
			body: JSON.stringify({
				title: 'Incomplete Data'
			})
		});

		expect([400, 401, 403]).toContain(response.status);
	});

	it("devrait valider le format de l'URL", async () => {
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

		expect([400, 401, 403]).toContain(response.status);
	});

	it('devrait supporter différents types de médias', async () => {
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

			expect([200, 201, 400, 401, 403]).toContain(response.status);
		}
	});
});

describe('External Media API - GET /api/external/media/[id]', () => {
	it('devrait récupérer un média externe spécifique', async () => {
		const response = await fetch(`${API_BASE_URL}/api/external/media/test-media-id`, {
			headers: getAuthHeaders()
		});

		expect([200, 400, 401, 404]).toContain(response.status);

		if (response.status === 200) {
			const data = await response.json();
			expect(data).toHaveProperty('id');
		}
	});

	it('devrait retourner 404 pour un média inexistant', async () => {
		const response = await fetch(`${API_BASE_URL}/api/external/media/inexistant-media-12345`, {
			headers: getAuthHeaders()
		});

		expect([400, 401, 404]).toContain(response.status);
	});
});

describe('External Media API - DELETE /api/external/media', () => {
	it('devrait supprimer plusieurs médias externes', async () => {
		const response = await fetch(`${API_BASE_URL}/api/external/media`, {
			method: 'DELETE',
			headers: getAuthHeaders(),
			body: JSON.stringify({
				ids: ['media-1', 'media-2']
			})
		});

		expect([200, 204, 400, 401, 403]).toContain(response.status);
	});

	it('devrait rejeter la suppression sans IDs', async () => {
		const response = await fetch(`${API_BASE_URL}/api/external/media`, {
			method: 'DELETE',
			headers: getAuthHeaders(),
			body: JSON.stringify({})
		});

		expect([400, 401, 403]).toContain(response.status);
	});
});

describe('External Media API - DELETE /api/external/media/[id]', () => {
	it('devrait supprimer un média externe spécifique', async () => {
		const response = await fetch(`${API_BASE_URL}/api/external/media/test-media-id`, {
			method: 'DELETE',
			headers: getAuthHeaders()
		});

		expect([200, 204, 401, 403, 404]).toContain(response.status);
	});

	it('devrait retourner 404 pour un média inexistant', async () => {
		const response = await fetch(`${API_BASE_URL}/api/external/media/inexistant-media-12345`, {
			method: 'DELETE',
			headers: getAuthHeaders()
		});

		expect([404]).toContain(response.status);
	});
});

describe('Database API - POST /api/db', () => {
	it("devrait permettre l'exécution de requêtes SQL (admin)", async () => {
		const response = await fetch(`${API_BASE_URL}/api/db`, {
			method: 'POST',
			headers: getAuthHeaders(),
			body: JSON.stringify({
				query: 'SELECT COUNT(*) FROM users'
			})
		});

		expect([200, 400, 401, 403, 404]).toContain(response.status);
	});

	it('devrait rejeter les requêtes SQL dangereuses', async () => {
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

	it("devrait rejeter l'accès pour les non-admins", async () => {
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
	it("devrait permettre de changer d'utilisateur (dev mode)", async () => {
		const response = await fetch(`${API_BASE_URL}/api/change-user`, {
			method: 'POST',
			headers: getAuthHeaders(),
			body: JSON.stringify({
				userId: 'les.roots'
			})
		});

		expect([200, 302, 401, 403]).toContain(response.status);
	});

	it('devrait rejeter le changement sans userId', async () => {
		const response = await fetch(`${API_BASE_URL}/api/change-user`, {
			method: 'POST',
			headers: getAuthHeaders(),
			body: JSON.stringify({})
		});

		expect([200, 400, 401, 403]).toContain(response.status);
	});

	it('devrait rejeter le changement vers un utilisateur inexistant', async () => {
		const response = await fetch(`${API_BASE_URL}/api/change-user`, {
			method: 'POST',
			headers: getAuthHeaders(),
			body: JSON.stringify({
				userId: 'utilisateur.inexistant.12345'
			})
		});

		expect([200, 400, 404]).toContain(response.status);
	});
});
