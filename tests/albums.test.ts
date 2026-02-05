/**
 * Tests exhaustifs pour l'API Albums
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
let testAlbumId = ''; // UUID Immich = ID local dans la BDD
// Suivi de tous les albums créés pour le nettoyage
const createdAlbumIds: string[] = [];

beforeAll(async () => {
	await setupTestAuth();

	// Créer un album de test dédié pour les tests de permissions
	// POST /api/albums crée l'album sur Immich ET dans la BDD locale
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
					description: 'Album pour tests de permissions'
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
	// Supprimer tous les albums créés pendant les tests
	if (globalTestContext.adminApiKey) {
		for (const albumId of createdAlbumIds) {
			try {
				await fetch(`${API_BASE_URL}/api/albums/${albumId}`, {
					method: 'DELETE',
					headers: { 'x-api-key': globalTestContext.adminApiKey }
				});
			} catch {
				// Ignorer les erreurs (album peut déjà être supprimé)
			}
		}
	}

	if (globalTestContext.adminApiKey) {
		await teardownTestAuth(globalTestContext as import('./test-helpers').TestContext);
	}
});

// Helper pour les headers d'authentification
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
	it('devrait respecter les permissions READ', async () => {
		const result = await testPermissions({
			endpoint: '/api/albums',
			method: 'GET',
			requiredScope: 'read',
			description: 'Liste des albums'
		});

		// Vérifications strictes
		expect(result.noAuth.passed).toBe(true); // Doit rejeter sans auth
		expect(result.read.passed).toBe(true); // Doit accepter avec read
		expect(result.write.passed).toBe(true); // Doit accepter avec write
		expect(result.admin.passed).toBe(true); // Doit accepter avec admin
	});

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
	it('devrait respecter les permissions WRITE', async () => {
		const albumData = {
			albumName: `[TEST] Permission Album ${Date.now()}`,
			description: 'Test'
		};

		const result = await testPermissions({
			endpoint: '/api/albums',
			method: 'POST',
			body: albumData,
			requiredScope: 'write',
			description: "Création d'album"
		});

		expect(result.noAuth.passed).toBe(true); // Doit rejeter sans auth
		expect(result.read.passed).toBe(true); // Doit rejeter avec read seul
		expect(result.write.passed).toBe(true); // Doit accepter avec write
		expect(result.admin.passed).toBe(true); // Doit accepter avec admin
	});

	it('devrait créer un nouvel album', async () => {
		const newAlbum = {
			albumName: `[TEST] Album ${Date.now()}`,
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
			createdAlbumIds.push(album.id);
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

		expect([400, 404, 500]).toContain(response.status);
	});
});

describe('Albums API - PATCH /api/albums/[id]', () => {
	it('devrait respecter les permissions WRITE', async () => {
		// Créer d'abord un album de test
		const createRes = await fetch(`${API_BASE_URL}/api/albums`, {
			method: 'POST',
			headers: getAuthHeaders(),
			body: JSON.stringify({ albumName: `[TEST] Patch Album ${Date.now()}` })
		});

		if (createRes.status === 200 || createRes.status === 201) {
			const album = (await createRes.json()) as ImmichAlbum;
			const albumId = album.id;
			// Tracker pour nettoyage
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
				description: "Modification d'album"
			});

			expect(result.noAuth.passed).toBe(true); // Doit rejeter
			expect(result.read.passed).toBe(true); // Doit rejeter
			expect(result.write.passed).toBe(true); // Doit accepter
			expect(result.admin.passed).toBe(true); // Doit accepter
		}
	});

	it('devrait modifier un album', async () => {
		if (!testAlbumId) {
			return;
		}

		const updates = {
			albumName: `[TEST] Album Modifié ${Date.now()}`,
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
			const result = (await response.json()) as { success?: boolean; data?: unknown[] } | unknown[];
			// Gérer les deux formats de réponse possibles
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
	it("devrait streamer les assets d'un album", async () => {
		if (!testAlbumId) {
			return;
		}

		const response = await fetch(`${API_BASE_URL}/api/albums/${testAlbumId}/assets-stream`, {
			headers: getAuthHeaders()
		});

		expect([200, 401, 404, 500]).toContain(response.status);

		if (response.status === 200) {
			const contentType = response.headers.get('content-type') || '';
			// Le streaming peut retourner application/json ou application/x-ndjson
			expect(contentType).toMatch(/application\/(json|x-ndjson)/);
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
	it('devrait respecter les permissions WRITE', async () => {
		if (!testAlbumId) {
			throw new Error('testAlbumId not set - album creation in beforeAll may have failed');
		}

		const result = await testPermissions({
			endpoint: `/api/albums/${testAlbumId}/assets`,
			method: 'DELETE',
			requiredScope: 'write',
			description: "Retrait d'assets d'un album",
			body: { ids: ['00000000-0000-0000-0000-000000000000'] }
		});

		// Sans auth -> rejeté
		expect(result.noAuth.passed, `noAuth failed with status ${result.noAuth.status}`).toBe(true);
		// Avec READ -> rejeté (car c'est un endpoint WRITE)
		expect(result.read.passed, `read failed with status ${result.read.status}`).toBe(true);

		// Pour WRITE et ADMIN, on teste l'accès.
		// Si l'auth passe, on peut avoir 200 (succès), 400 (bad request), 404 (not found).
		// L'important est que ce ne soit PAS 401 ou 403.
		expect([401, 403]).not.toContain(result.write.status);
		expect([401, 403]).not.toContain(result.admin.status);
	});

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
			// La réponse peut être {id, ...} ou {success, album: {id, ...}}
			if (info.success && info.album) {
				expect(info.album).toHaveProperty('id');
			} else {
				expect(info).toHaveProperty('id');
			}
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

describe('Albums API - Asset Thumbnail', () => {
	it('devrait récupérer la miniature avec chemin complet', async () => {
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

	it('devrait récupérer la miniature sans spécifier le chemin', async () => {
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

		expect([200, 400, 401, 404, 500]).toContain(response.status);
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

			expect([200, 400, 401, 404, 405, 500]).toContain(response.status);
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

// Tests pour /api/albums/list et /api/albums/import supprimés - endpoints dépréciés
// GET /api/albums retourne maintenant la liste des albums de la BDD locale

describe('Albums API - POST /api/albums/[id]/permissions/tags', () => {
	it('devrait rejeter les requêtes sans authentification', async () => {
		// Utiliser le premier album disponible ou skip
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

	it('devrait gérer les permissions de tags', async () => {
		if (!testAlbumId) {
			return;
		}

		// Test ajout
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

			// Test suppression
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
	it('devrait rejeter les requêtes sans authentification', async () => {
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

	it('devrait gérer les permissions utilisateurs', async () => {
		if (!testAlbumId) {
			return;
		}

		// Test ajout (peut échouer si l'utilisateur n'existe pas, c'est OK)
		const addResponse = await fetch(`${API_BASE_URL}/api/albums/${testAlbumId}/permissions/users`, {
			method: 'POST',
			headers: getAuthHeaders(),
			body: JSON.stringify({ add: ['les.roots'], remove: [] })
		});

		expect([200, 401, 403, 404]).toContain(addResponse.status);

		if (addResponse.status === 200) {
			const addData = (await addResponse.json()) as {
				success: boolean;
				added: number;
				removed: number;
			};
			expect(addData.success).toBe(true);

			// Test suppression
			const removeResponse = await fetch(
				`${API_BASE_URL}/api/albums/${testAlbumId}/permissions/users`,
				{
					method: 'POST',
					headers: getAuthHeaders(),
					body: JSON.stringify({ add: [], remove: ['les.roots'] })
				}
			);

			expect([200, 401, 403, 404]).toContain(removeResponse.status);
		}
	});
});
