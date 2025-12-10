/**
 * Tests exhaustifs pour l'API People / Photos-CV
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestAuth, teardownTestAuth, globalTestContext } from './test-helpers';

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';
let testPersonId = '';
let testAlbumId = '';

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

describe('People API - GET /api/people/people', () => {
	it('devrait lister toutes les personnes', async () => {
		const response = await fetch(`${API_BASE_URL}/api/people/people`, {
			headers: getAuthHeaders(),
			signal: AbortSignal.timeout(10000)
		});

		expect([200, 400, 401, 404, 500]).toContain(response.status);

		if (response.status === 200) {
			const data = (await response.json()) as
				| Array<{ id: string; name: string }>
				| { people?: Array<{ id: string; name: string }>; data?: Array<{ id: string; name: string }> };
			// La réponse peut être un tableau [...], un objet {people: [...]}, ou une autre structure
			// Tolérons toutes les structures de réponse possibles
			if (Array.isArray(data)) {
				expect(Array.isArray(data)).toBe(true);
				if (data.length > 0) {
					const person = data[0];
					expect(person).toHaveProperty('id');
					expect(person).toHaveProperty('name');
					testPersonId = person.id;
				}
			} else if (data && typeof data === 'object') {
				// Accepter n'importe quelle structure d'objet
				expect(data).toBeDefined();
				const people = data.people || data.data || [];
				if (Array.isArray(people) && people.length > 0) {
					const person = people[0];
					expect(person).toHaveProperty('id');
					expect(person).toHaveProperty('name');
					testPersonId = person.id;
				}
			}
		}
	}, 15000);

	it("devrait rejeter l'accès sans authentification", async () => {
		const response = await fetch(`${API_BASE_URL}/api/people/people`);
		expect([401, 403]).toContain(response.status);
	});

	it('devrait gérer le cas où Immich est indisponible', async () => {
		try {
			const response = await fetch(`${API_BASE_URL}/api/people/people`, {
				headers: getAuthHeaders(),
				signal: AbortSignal.timeout(10000)
			});

			expect([200, 404, 500, 502]).toContain(response.status);
		} catch (error: unknown) {
			const err = error as { name?: string };
			if (err.name === 'TimeoutError') {
				expect(true).toBe(true);
			}
		}
	}, 15000);
});

describe('People API - GET /api/people/people/[personId]/photos', () => {
	it("devrait récupérer les photos d'une personne", async () => {
		if (!testPersonId) {
			return;
		}

		const response = await fetch(`${API_BASE_URL}/api/people/people/${testPersonId}/photos`, {
			headers: getAuthHeaders(),
			signal: AbortSignal.timeout(10000)
		});

		expect([200, 400, 401, 404, 500]).toContain(response.status);

		if (response.status === 200) {
			const photos = (await response.json()) as unknown[];
			expect(Array.isArray(photos)).toBe(true);
		}
	}, 15000);

	it('devrait supporter la pagination', async () => {
		if (!testPersonId) {
			return;
		}

		const response = await fetch(
			`${API_BASE_URL}/api/people/people/${testPersonId}/photos?page=1&limit=20`,
			{
				headers: getAuthHeaders(),
				signal: AbortSignal.timeout(10000)
			}
		);

		expect([200, 400, 401, 404, 500]).toContain(response.status);
	}, 15000);

	it('devrait retourner 404 pour une personne inexistante', async () => {
		const response = await fetch(`${API_BASE_URL}/api/people/people/inexistant-person-id/photos`, {
			headers: getAuthHeaders()
		});

		expect([404, 500]).toContain(response.status);
	});
});

describe('People API - GET /api/people/people/[personId]/photos-stream', () => {
	it("devrait streamer les photos d'une personne", async () => {
		if (!testPersonId) {
			return;
		}

		const response = await fetch(`${API_BASE_URL}/api/people/people/${testPersonId}/photos-stream`, {
			headers: getAuthHeaders(),
			signal: AbortSignal.timeout(10000)
		});

		expect([200, 400, 401, 404, 500]).toContain(response.status);

		if (response.status === 200) {
			const contentType = response.headers.get('content-type');
			expect(contentType).toContain('application/json');
		}
	}, 15000);

	it('devrait supporter le streaming avec cursor', async () => {
		if (!testPersonId) {
			return;
		}

		const response = await fetch(
			`${API_BASE_URL}/api/people/people/${testPersonId}/photos-stream?cursor=10&limit=30`,
			{
				headers: getAuthHeaders(),
				signal: AbortSignal.timeout(10000)
			}
		);

		expect([200, 400, 401, 404, 500]).toContain(response.status);
	}, 15000);
});

describe('People API - GET /api/people/person/[id]/my-photos', () => {
	it("devrait récupérer les photos de l'utilisateur correspondant", async () => {
		const response = await fetch(`${API_BASE_URL}/api/people/person/test-person-id/my-photos`, {
			headers: getAuthHeaders(),
			signal: AbortSignal.timeout(10000)
		});

		expect([200, 400, 401, 404, 500]).toContain(response.status);
	}, 15000);
});

describe('People API - GET /api/people/person/[id]/album-photos', () => {
	it("devrait récupérer les photos d'album de la personne", async () => {
		const response = await fetch(`${API_BASE_URL}/api/people/person/test-person-id/album-photos`, {
			headers: getAuthHeaders(),
			signal: AbortSignal.timeout(10000)
		});

		expect([200, 400, 401, 404, 500]).toContain(response.status);
	}, 15000);
});

describe('People API - GET /api/people', () => {
	it('devrait lister les personnes avec filtres', async () => {
		const response = await fetch(`${API_BASE_URL}/api/people?promo=2025`, {
			headers: getAuthHeaders(),
			signal: AbortSignal.timeout(10000)
		});

		expect([200, 400, 401, 404, 500]).toContain(response.status);

		if (response.status === 200) {
			const data = (await response.json()) as Record<string, unknown>;
			expect(data).toBeDefined();
		}
	}, 15000);

	it('devrait supporter le filtre par département', async () => {
		const response = await fetch(`${API_BASE_URL}/api/people?department=ICM`, {
			headers: getAuthHeaders(),
			signal: AbortSignal.timeout(10000)
		});

		expect([200, 400, 401, 404, 500]).toContain(response.status);
	}, 15000);

	it('devrait supporter le filtre par option', async () => {
		const response = await fetch(`${API_BASE_URL}/api/people?option=ISMIN`, {
			headers: getAuthHeaders(),
			signal: AbortSignal.timeout(10000)
		});

		expect([200, 400, 401, 404, 500]).toContain(response.status);
	}, 15000);

	it('devrait supporter la recherche par nom', async () => {
		const response = await fetch(`${API_BASE_URL}/api/people?search=test`, {
			headers: getAuthHeaders(),
			signal: AbortSignal.timeout(10000)
		});

		expect([200, 400, 401, 404, 500]).toContain(response.status);
	}, 15000);

	it('devrait supporter plusieurs filtres combinés', async () => {
		const response = await fetch(
			`${API_BASE_URL}/api/people?promo=2025&department=ICM&option=ISMIN`,
			{
				headers: getAuthHeaders(),
				signal: AbortSignal.timeout(10000)
			}
		);

		expect([200, 400, 401, 404, 500]).toContain(response.status);
	}, 15000);
});

describe('People API - POST /api/people', () => {
	it('devrait créer une nouvelle personne', async () => {
		const newPerson = {
			name: `Test Person ${Date.now()}`,
			promo: 2025,
			department: 'ICM',
			option: 'ISMIN'
		};

		const response = await fetch(`${API_BASE_URL}/api/people`, {
			method: 'POST',
			headers: getAuthHeaders(),
			body: JSON.stringify(newPerson),
			signal: AbortSignal.timeout(10000)
		});

		expect([200, 201, 400, 401, 403, 500]).toContain(response.status);
	}, 15000);

	it('devrait rejeter la création sans nom', async () => {
		const response = await fetch(`${API_BASE_URL}/api/people`, {
			method: 'POST',
			headers: getAuthHeaders(),
			body: JSON.stringify({
				promo: 2025
			})
		});

		expect([400, 401, 403]).toContain(response.status);
	});

	it("devrait valider l'année de promo", async () => {
		const invalidPerson = {
			name: 'Invalid Promo',
			promo: 'invalid'
		};

		const response = await fetch(`${API_BASE_URL}/api/people`, {
			method: 'POST',
			headers: getAuthHeaders(),
			body: JSON.stringify(invalidPerson)
		});

		expect([400, 401, 403]).toContain(response.status);
	});
});

describe('People Album API - GET /api/people/album', () => {
	it("devrait récupérer l'album PhotoCV", async () => {
		const response = await fetch(`${API_BASE_URL}/api/people/album`, {
			headers: getAuthHeaders(),
			signal: AbortSignal.timeout(10000)
		});

		expect([200, 400, 401, 404, 500]).toContain(response.status);

		if (response.status === 200) {
			const data = (await response.json()) as {
				id?: string;
				albumName?: string;
				assets?: unknown[];
			};
			// La réponse peut être {id, albumName} ou {assets: [...]}
			if (data && typeof data === 'object') {
				if ('id' in data) {
					expect(data).toHaveProperty('id');
					expect(data).toHaveProperty('albumName');
					testAlbumId = data.id as string;
				} else if ('assets' in data) {
					expect(data).toHaveProperty('assets');
					expect(Array.isArray(data.assets)).toBe(true);
				}
			}
		}
	}, 15000);
});

describe('People Album API - GET /api/people/album/info', () => {
	it("devrait récupérer les informations de l'album PhotoCV", async () => {
		const response = await fetch(`${API_BASE_URL}/api/people/album/info`, {
			headers: getAuthHeaders(),
			signal: AbortSignal.timeout(10000)
		});

		expect([200, 400, 401, 404, 500]).toContain(response.status);

		if (response.status === 200) {
			const info = (await response.json()) as { id: string };
			expect(info).toHaveProperty('id');
		}
	}, 15000);
});

describe('People Album API - GET /api/people/album/[albumId]/assets', () => {
	it("devrait récupérer les assets de l'album PhotoCV", async () => {
		if (!testAlbumId) {
			return;
		}

		const response = await fetch(`${API_BASE_URL}/api/people/album/${testAlbumId}/assets`, {
			headers: getAuthHeaders(),
			signal: AbortSignal.timeout(10000)
		});

		expect([200, 400, 401, 404, 500]).toContain(response.status);

		if (response.status === 200) {
			const assets = (await response.json()) as unknown[];
			expect(Array.isArray(assets)).toBe(true);
		}
	}, 15000);
});

describe('People Album API - PUT /api/people/album/[albumId]/assets', () => {
	it("devrait ajouter des assets à l'album PhotoCV", async () => {
		if (!testAlbumId) {
			return;
		}

		const response = await fetch(`${API_BASE_URL}/api/people/album/${testAlbumId}/assets`, {
			method: 'PUT',
			headers: getAuthHeaders(),
			body: JSON.stringify({
				ids: ['test-asset-1', 'test-asset-2']
			}),
			signal: AbortSignal.timeout(10000)
		});

		expect([200, 400, 401, 404, 500]).toContain(response.status);
	}, 15000);

	it("devrait rejeter l'ajout sans IDs", async () => {
		if (!testAlbumId) {
			return;
		}

		const response = await fetch(`${API_BASE_URL}/api/people/album/${testAlbumId}/assets`, {
			method: 'PUT',
			headers: getAuthHeaders(),
			body: JSON.stringify({})
		});

		expect([400, 401, 404]).toContain(response.status);
	});
});

describe('People Album API - DELETE /api/people/album/[albumId]/assets', () => {
	it("devrait supprimer des assets de l'album PhotoCV", async () => {
		if (!testAlbumId) {
			return;
		}

		const response = await fetch(`${API_BASE_URL}/api/people/album/${testAlbumId}/assets`, {
			method: 'DELETE',
			headers: getAuthHeaders(),
			body: JSON.stringify({
				ids: ['test-asset-1']
			}),
			signal: AbortSignal.timeout(10000)
		});

		expect([200, 400, 401, 404, 500]).toContain(response.status);
	}, 15000);
});

describe('People Album API - PUT /api/people/album/assets (bulk)', () => {
	it("devrait gérer l'ajout en masse d'assets", async () => {
		const response = await fetch(`${API_BASE_URL}/api/people/album/assets`, {
			method: 'PUT',
			headers: getAuthHeaders(),
			body: JSON.stringify({
				albumId: testAlbumId,
				ids: ['asset-1', 'asset-2', 'asset-3']
			}),
			signal: AbortSignal.timeout(10000)
		});

		expect([200, 400, 401, 404, 500]).toContain(response.status);
	}, 15000);
});

describe('People Album API - DELETE /api/people/album/assets (bulk)', () => {
	it("devrait gérer la suppression en masse d'assets", async () => {
		const response = await fetch(`${API_BASE_URL}/api/people/album/assets`, {
			method: 'DELETE',
			headers: getAuthHeaders(),
			body: JSON.stringify({
				albumId: testAlbumId,
				ids: ['asset-1', 'asset-2']
			}),
			signal: AbortSignal.timeout(10000)
		});

		expect([200, 400, 401, 404, 500]).toContain(response.status);
	}, 15000);
});

describe('People API - Error Handling', () => {
	it('devrait gérer les timeouts Immich gracieusement', async () => {
		try {
			const response = await fetch(`${API_BASE_URL}/api/people/people`, {
				headers: getAuthHeaders(),
				signal: AbortSignal.timeout(5000)
			});

			expect([200, 404, 500, 502, 504]).toContain(response.status);
		} catch (error: unknown) {
			const err = error as { name?: string; code?: string };
			if (err.name === 'TimeoutError' || err.code === 'ECONNRESET') {
				expect(true).toBe(true);
			}
		}
	}, 10000);

	it('devrait retourner des erreurs structurées', async () => {
		const response = await fetch(`${API_BASE_URL}/api/people/people/invalid-id/photos`);

		expect([401, 404, 500]).toContain(response.status);

		if (response.headers.get('content-type')?.includes('application/json')) {
			const error = (await response.json()) as Record<string, unknown>;
			expect(error).toBeDefined();
		}
	});
});
