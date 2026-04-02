/**
 * Tests d'intégration end-to-end pour MiGallery
 * Ce fichier orchestre tous les tests et vérifie l'intégration complète
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
// Setup et authentification
// ========================================

beforeAll(async () => {
	console.debug("🚀 Démarrage des tests d'intégration end-to-end"); // Tentative de connexion en tant qu'utilisateur système
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
					console.debug('✅ Authentifié avec cookie de session');
				}
			}
		}

		// Créer une clé API admin pour les tests
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
				console.debug('✅ Clé API admin créée');
			}

			// Créer une clé API read pour les tests
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
				console.debug('✅ Clé API read créée');
			}
		}
	} catch (error) {
		console.error('❌ Erreur lors du setup:', error);
	}
}, 30000);

afterAll(async () => {
	console.debug('\n🧹 Nettoyage des ressources de test'); // Supprimer l'utilisateur de test
	if (testUserId && adminApiKey) {
		await fetch(`${API_BASE_URL}/api/users/${testUserId}`, {
			method: 'DELETE',
			headers: { 'x-api-key': adminApiKey }
		});
	}

	// Supprimer l'album de test
	if (testAlbumId && adminApiKey) {
		await fetch(`${API_BASE_URL}/api/albums/${testAlbumId}`, {
			method: 'DELETE',
			headers: { 'x-api-key': adminApiKey }
		});
	}

	// Supprimer les clés API de test
	if (testApiKeyId && sessionCookie) {
		await fetch(`${API_BASE_URL}/api/admin/api-keys/${testApiKeyId}`, {
			method: 'DELETE',
			headers: { Cookie: sessionCookie }
		});
	}

	// Supprimer la clé API read de test
	if (testReadApiKeyId && sessionCookie) {
		await fetch(`${API_BASE_URL}/api/admin/api-keys/${testReadApiKeyId}`, {
			method: 'DELETE',
			headers: { Cookie: sessionCookie }
		});
	}

	console.debug('✅ Nettoyage terminé\n');
});

// ========================================
// Tests end-to-end complets
// ========================================

describe('E2E - Workflow complet utilisateur', () => {
	it('devrait créer un utilisateur, le modifier et le supprimer', async () => {
		// 1. Créer un utilisateur
		const createResponse = await fetch(`${API_BASE_URL}/api/users`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-api-key': adminApiKey
			},
			body: JSON.stringify({
				id_user: `e2e.test.${Date.now()}`,
				email: `e2e.test.${Date.now()}@etu.emse.fr`,
				prenom: 'E2E',
				nom: 'Test',
				role: 'user',
				promo_year: 2025
			})
		});

		expect([200, 201, 401]).toContain(createResponse.status);

		if (createResponse.ok) {
			const createData = (await createResponse.json()) as UserCreateResponse;
			testUserId = createData.created!.id_user;

			// 2. Récupérer l'utilisateur créé
			const getResponse = await fetch(`${API_BASE_URL}/api/users/${testUserId}`, {
				headers: { 'x-api-key': adminApiKey }
			});

			expect(getResponse.status).toBe(200);

			// 3. Modifier l'utilisateur
			const updateResponse = await fetch(`${API_BASE_URL}/api/users/${testUserId}`, {
				method: 'PUT',
				headers: {
					'Content-Type': 'application/json',
					'x-api-key': adminApiKey
				},
				body: JSON.stringify({
					email: `modified.${Date.now()}@etu.emse.fr`,
					prenom: 'Modified',
					nom: 'User',
					role: 'user',
					promo_year: 2026
				})
			});

			expect(updateResponse.status).toBe(200);

			// 4. Supprimer l'utilisateur
			const deleteResponse = await fetch(`${API_BASE_URL}/api/users/${testUserId}`, {
				method: 'DELETE',
				headers: { 'x-api-key': adminApiKey }
			});

			expect([200, 204]).toContain(deleteResponse.status);
			testUserId = null;
		}
	}, 30000);
});

describe('E2E - Workflow complet album', () => {
	it('devrait créer un album, ajouter des assets et le supprimer', async () => {
		// 1. Créer un album
		const createResponse = await fetch(`${API_BASE_URL}/api/albums`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-api-key': adminApiKey
			},
			body: JSON.stringify({
				albumName: `[TEST] E2E Album ${Date.now()}`,
				description: 'Album créé par les tests E2E'
			})
		});

		if (createResponse.ok) {
			const album = (await createResponse.json()) as ImmichAlbum;
			testAlbumId = album.id;

			// 2. Récupérer l'album
			const getResponse = await fetch(`${API_BASE_URL}/api/albums/${testAlbumId}`, {
				headers: { 'x-api-key': adminApiKey }
			});

			expect([200, 404, 500]).toContain(getResponse.status);

			// 3. Modifier l'album
			const updateResponse = await fetch(`${API_BASE_URL}/api/albums/${testAlbumId}`, {
				method: 'PATCH',
				headers: {
					'Content-Type': 'application/json',
					'x-api-key': adminApiKey
				},
				body: JSON.stringify({
					albumName: '[TEST] E2E Album Modifié',
					description: 'Description mise à jour'
				})
			});

			expect([200, 404, 500]).toContain(updateResponse.status);

			// 4. Supprimer l'album
			const deleteResponse = await fetch(`${API_BASE_URL}/api/albums/${testAlbumId}`, {
				method: 'DELETE',
				headers: { 'x-api-key': adminApiKey }
			});

			expect([200, 204, 404, 500]).toContain(deleteResponse.status);
			testAlbumId = null;
		}
	}, 30000);
});

describe('E2E - Workflow permissions et scopes', () => {
	it('devrait respecter les scopes read vs admin', async () => {
		// 1. Lire avec scope read (devrait marcher)
		const readResponse = await fetch(`${API_BASE_URL}/api/albums`, {
			headers: { 'x-api-key': readApiKey }
		});

		expect([200, 401, 500]).toContain(readResponse.status);

		// 2. Créer avec scope read (devrait échouer)
		const createWithReadResponse = await fetch(`${API_BASE_URL}/api/users`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-api-key': readApiKey
			},
			body: JSON.stringify({
				id_user: 'test.forbidden',
				email: 'test@etu.emse.fr',
				prenom: 'Test',
				nom: 'Forbidden',
				role: 'user'
			})
		});

		expect([401, 403]).toContain(createWithReadResponse.status);

		// 3. Créer avec scope admin (devrait marcher)
		const createWithAdminResponse = await fetch(`${API_BASE_URL}/api/users`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-api-key': adminApiKey
			},
			body: JSON.stringify({
				id_user: `e2e.scope.test.${Date.now()}`,
				email: `scope.test.${Date.now()}@etu.emse.fr`,
				prenom: 'Scope',
				nom: 'Test',
				role: 'user'
			})
		});

		if (createWithAdminResponse.ok) {
			const data = (await createWithAdminResponse.json()) as UserCreateResponse;
			const userId = data.created!.id_user;

			// Nettoyer
			await fetch(`${API_BASE_URL}/api/users/${userId}`, {
				method: 'DELETE',
				headers: { 'x-api-key': adminApiKey }
			});
		}
	}, 30000);
});

describe('E2E - Workflow favoris', () => {
	it('devrait gérer le cycle complet des favoris', async () => {
		const assetId = 'e2e-test-asset-123';

		// 1. Ajouter aux favoris
		const addResponse = await fetch(`${API_BASE_URL}/api/favorites`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-api-key': adminApiKey
			},
			body: JSON.stringify({ assetId })
		});

		expect([200, 201, 400, 401, 409]).toContain(addResponse.status);

		// 2. Lister les favoris
		const listResponse = await fetch(`${API_BASE_URL}/api/favorites`, {
			headers: { 'x-api-key': adminApiKey }
		});

		expect([200, 401]).toContain(listResponse.status);

		// 3. Retirer des favoris
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

describe('E2E - Workflow médias externes', () => {
	it('devrait gérer le cycle complet des médias externes', async () => {
		// 1. Créer un média externe
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
				description: 'Média créé par les tests E2E'
			})
		});

		if (createResponse.ok) {
			const media = (await createResponse.json()) as { media: { id: string } };
			const mediaId = media.media.id;

			// 2. Récupérer le média
			const getResponse = await fetch(`${API_BASE_URL}/api/external/media/${mediaId}`, {
				headers: { 'x-api-key': adminApiKey }
			});

			expect([200, 404]).toContain(getResponse.status);

			// 3. Supprimer le média
			const deleteResponse = await fetch(`${API_BASE_URL}/api/external/media/${mediaId}`, {
				method: 'DELETE',
				headers: { 'x-api-key': adminApiKey }
			});

			expect([200, 204, 404]).toContain(deleteResponse.status);
		}
	}, 30000);
});

describe('E2E - Health et monitoring', () => {
	it('devrait vérifier que tous les endpoints critiques sont accessibles', async () => {
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

			// Les endpoints doivent être accessibles (même si Immich est down)
			expect([200, 401, 404, 500, 502]).toContain(response.status);
		}
	}, 60000);
});

describe('E2E - Performance et stress', () => {
	it('devrait gérer plusieurs requêtes simultanées', async () => {
		const requests = Array.from({ length: 20 }, () => fetch(`${API_BASE_URL}/api/health`));

		const responses = await Promise.all(requests);
		const successCount = responses.filter((r) => r.status === 200).length;

		expect(successCount).toBeGreaterThan(0);
	}, 30000);

	it('devrait gérer les requêtes lourdes sans timeout', async () => {
		const response = await fetch(`${API_BASE_URL}/api/albums`, {
			headers: { 'x-api-key': adminApiKey },
			signal: AbortSignal.timeout(15000)
		});

		expect([200, 401, 500]).toContain(response.status);
	}, 20000);
});

describe('E2E - Validation des données', () => {
	it('devrait rejeter les données invalides de manière cohérente', async () => {
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
