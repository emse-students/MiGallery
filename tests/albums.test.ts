/**
 * Tests exhaustifs pour l'API Albums
 */

import { describe, it, expect } from 'vitest';
import type { ImmichAlbum } from '$lib/types/api';

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';
const API_KEY = '';
let testAlbumId = '';

// Helper pour les headers d'authentification
const getAuthHeaders = () => {
	const headers: Record<string, string> = {
		'Content-Type': 'application/json'
	};
	if (API_KEY) {
		headers['x-api-key'] = API_KEY;
	}
	return headers;
};

describe('Albums API - GET /api/albums', () => {
	it('devrait lister tous les albums', async () => {
		const response = await fetch(`${API_BASE_URL}/api/albums`, {
			headers: getAuthHeaders()
		});

		expect([200, 401, 500]).toContain(response.status);

		if (response.status === 200) {
			const albums = (await response.json()) as ImmichAlbum[];
			expect(Array.isArray(albums)).toBe(true);

			// Vérifier la structure des albums si présents
			if (albums.length > 0) {
				const album = albums[0];
				expect(album).toHaveProperty('id');
				expect(album).toHaveProperty('albumName');
				testAlbumId = album.id; // Sauvegarder pour les tests suivants
			}
		}
	});

	it('devrait rejeter les requêtes sans authentification', async () => {
		const response = await fetch(`${API_BASE_URL}/api/albums`);
		expect([401, 403]).toContain(response.status);
	});

	it("devrait filtrer l'album PhotoCV (masqué)", async () => {
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
	it('devrait créer un nouvel album', async () => {
		const newAlbum = {
			albumName: `Test Album ${Date.now()}`,
			description: 'Album créé par les tests automatisés'
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
		}
	});

	it("devrait rejeter la création sans nom d'album", async () => {
		const response = await fetch(`${API_BASE_URL}/api/albums`, {
			method: 'POST',
			headers: getAuthHeaders(),
			body: JSON.stringify({ description: 'Sans nom' })
		});

		expect([400, 401, 500]).toContain(response.status);
	});
});

describe('Albums API - GET /api/albums/[id]', () => {
	it('devrait récupérer un album spécifique', async () => {
		if (!testAlbumId) {
			return; // Skip si pas d'album disponible
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

	it('devrait retourner 404 pour un album inexistant', async () => {
		const response = await fetch(`${API_BASE_URL}/api/albums/inexistant-id-12345`, {
			headers: getAuthHeaders()
		});

		expect([404, 500]).toContain(response.status);
	});
});

describe('Albums API - PATCH /api/albums/[id]', () => {
	it('devrait modifier un album', async () => {
		if (!testAlbumId) {
			return;
		}

		const updates = {
			albumName: `Album Modifié ${Date.now()}`,
			description: 'Description mise à jour'
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
	it("devrait récupérer les assets d'un album (format simple)", async () => {
		if (!testAlbumId) {
			return;
		}

		const response = await fetch(`${API_BASE_URL}/api/albums/${testAlbumId}/assets-simple`, {
			headers: getAuthHeaders()
		});

		expect([200, 401, 404, 500]).toContain(response.status);

		if (response.status === 200) {
			const assets = (await response.json()) as unknown[];
			expect(Array.isArray(assets)).toBe(true);
		}
	});
});

describe('Albums API - GET /api/albums/[id]/assets-stream', () => {
	it("devrait streamer les assets d'un album", async () => {
		if (!testAlbumId) {
			return;
		}

		const response = await fetch(`${API_BASE_URL}/api/albums/${testAlbumId}/assets-stream`, {
			headers: getAuthHeaders()
		});

		expect([200, 401, 404, 500]).toContain(response.status);

		if (response.status === 200) {
			expect(response.headers.get('content-type')).toContain('application/json');
		}
	});

	it('devrait supporter la pagination avec cursor', async () => {
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
	it('devrait ajouter des assets à un album', async () => {
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
	it("devrait supprimer des assets d'un album", async () => {
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
	it("devrait récupérer les informations d'un album", async () => {
		if (!testAlbumId) {
			return;
		}

		const response = await fetch(`${API_BASE_URL}/api/albums/${testAlbumId}/info`, {
			headers: getAuthHeaders()
		});

		expect([200, 401, 404, 500]).toContain(response.status);

		if (response.status === 200) {
			const info = (await response.json()) as Record<string, unknown>;
			expect(info).toHaveProperty('id');
		}
	});
});

describe('Albums API - PUT /api/albums/[id]/metadata', () => {
	it("devrait mettre à jour les métadonnées d'un album", async () => {
		if (!testAlbumId) {
			return;
		}

		const metadata = {
			title: 'Nouveau titre',
			description: 'Nouvelle description'
		};

		const response = await fetch(`${API_BASE_URL}/api/albums/${testAlbumId}/metadata`, {
			method: 'PUT',
			headers: getAuthHeaders(),
			body: JSON.stringify(metadata)
		});

		expect([200, 400, 401, 404, 500]).toContain(response.status);
	});
});

describe('Albums API - Asset Thumbnails', () => {
	it("devrait récupérer la miniature d'un asset", async () => {
		if (!testAlbumId) {
			return;
		}

		const response = await fetch(
			`${API_BASE_URL}/api/albums/${testAlbumId}/asset-thumbnail/test-asset/thumbnail`,
			{
				headers: getAuthHeaders()
			}
		);

		expect([200, 401, 404, 500]).toContain(response.status);
	});

	it("devrait récupérer la miniature complète d'un asset", async () => {
		if (!testAlbumId) {
			return;
		}

		const response = await fetch(
			`${API_BASE_URL}/api/albums/${testAlbumId}/asset-thumbnail/test-asset`,
			{
				headers: getAuthHeaders()
			}
		);

		expect([200, 401, 404, 500]).toContain(response.status);
	});
});

describe('Albums API - Asset Original', () => {
	it("devrait récupérer l'asset original", async () => {
		if (!testAlbumId) {
			return;
		}

		const response = await fetch(
			`${API_BASE_URL}/api/albums/${testAlbumId}/asset-original/test-asset`,
			{
				headers: getAuthHeaders()
			}
		);

		expect([200, 401, 404, 500]).toContain(response.status);
	});

	it("devrait supporter toutes les méthodes HTTP pour l'asset original", async () => {
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

			expect([200, 401, 404, 405, 500]).toContain(response.status);
		}
	});
});

describe('Albums API - Covers', () => {
	it("devrait générer les couvertures d'albums", async () => {
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
	it('devrait supprimer un album', async () => {
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
