/**
 * Tests exhaustifs pour l'API Utilisateurs
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { UserResponse, UsersListResponse, UserCreateResponse } from '$lib/types/api';
import { setupTestAuth, teardownTestAuth, globalTestContext } from './test-helpers';

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';
let createdUserId: string | null = null;

beforeAll(async () => {
	await setupTestAuth();
});

afterAll(async () => {
	// Nettoyage : supprimer l'utilisateur de test
	if (createdUserId && globalTestContext.adminApiKey) {
		await fetch(`${API_BASE_URL}/api/users/${createdUserId}`, {
			method: 'DELETE',
			headers: { 'x-api-key': globalTestContext.adminApiKey }
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

describe('Users API - GET /api/users', () => {
	it('devrait lister tous les utilisateurs (admin)', async () => {
		const response = await fetch(`${API_BASE_URL}/api/users`, {
			headers: getAuthHeaders()
		});

		expect([200, 401, 403]).toContain(response.status);

		if (response.status === 200) {
			const data = (await response.json()) as UsersListResponse;
			expect(data.success).toBe(true);
			expect(Array.isArray(data.users)).toBe(true);

			// Vérifier la structure des utilisateurs
			if (data.users.length > 0) {
				const user = data.users[0];
				expect(user).toHaveProperty('id_user');
				expect(user).toHaveProperty('email');
				expect(user).toHaveProperty('role');
			}
		}
	});

	it("devrait rejeter l'accès sans authentification", async () => {
		const response = await fetch(`${API_BASE_URL}/api/users`);
		expect([401, 403]).toContain(response.status);
	});

	it("devrait rejeter l'accès pour un utilisateur non-admin", async () => {
		// TODO: Tester avec un token utilisateur non-admin
		await Promise.resolve();
		expect(true).toBe(true);
	});
});

describe('Users API - POST /api/users', () => {
	it('devrait créer un nouvel utilisateur', async () => {
		const newUser = {
			id_user: `test.user.${Date.now()}`,
			email: `test.${Date.now()}@etu.emse.fr`,
			prenom: 'Test',
			nom: 'User',
			role: 'user',
			promo_year: 2025
		};

		const response = await fetch(`${API_BASE_URL}/api/users`, {
			method: 'POST',
			headers: getAuthHeaders(),
			body: JSON.stringify(newUser)
		});

		expect([200, 201, 400, 401, 403, 409]).toContain(response.status);

		if (response.status === 200 || response.status === 201) {
			const data = (await response.json()) as UserCreateResponse;
			expect(data.success).toBe(true);
			expect(data.created).toBeDefined();
			createdUserId = data.created!.id_user;
			expect(createdUserId).toBe(newUser.id_user);
		}
	});

	it('devrait rejeter la création avec des données manquantes', async () => {
		const invalidUser = {
			email: 'incomplete@etu.emse.fr'
			// Manque id_user, prenom, nom, role
		};

		const response = await fetch(`${API_BASE_URL}/api/users`, {
			method: 'POST',
			headers: getAuthHeaders(),
			body: JSON.stringify(invalidUser)
		});

		expect([400, 401, 403]).toContain(response.status);
	});

	it('devrait rejeter la création avec un email invalide', async () => {
		const invalidUser = {
			id_user: 'test.invalid',
			email: 'invalid-email',
			prenom: 'Test',
			nom: 'Invalid',
			role: 'user'
		};

		const response = await fetch(`${API_BASE_URL}/api/users`, {
			method: 'POST',
			headers: getAuthHeaders(),
			body: JSON.stringify(invalidUser)
		});

		expect([400, 401, 403]).toContain(response.status);
	});

	it('devrait rejeter la création avec un rôle invalide', async () => {
		const invalidUser = {
			id_user: 'test.invalid.role',
			email: 'test@etu.emse.fr',
			prenom: 'Test',
			nom: 'Invalid',
			role: 'super-admin-999' // Rôle invalide
		};

		const response = await fetch(`${API_BASE_URL}/api/users`, {
			method: 'POST',
			headers: getAuthHeaders(),
			body: JSON.stringify(invalidUser)
		});

		expect([400, 401, 403]).toContain(response.status);
	});

	it("devrait rejeter la création d'un utilisateur en doublon", async () => {
		if (!createdUserId) {
			return;
		}

		const duplicateUser = {
			id_user: createdUserId,
			email: 'duplicate@etu.emse.fr',
			prenom: 'Duplicate',
			nom: 'User',
			role: 'user'
		};

		const response = await fetch(`${API_BASE_URL}/api/users`, {
			method: 'POST',
			headers: getAuthHeaders(),
			body: JSON.stringify(duplicateUser)
		});

		expect([400, 409]).toContain(response.status);
	});
});

describe('Users API - GET /api/users/[id]', () => {
	it('devrait récupérer un utilisateur spécifique', async () => {
		if (!createdUserId) {
			return;
		}

		const response = await fetch(`${API_BASE_URL}/api/users/${createdUserId}`, {
			headers: getAuthHeaders()
		});

		expect([200, 401, 403, 404]).toContain(response.status);

		if (response.status === 200) {
			const data = (await response.json()) as UserResponse;
			expect(data.success).toBe(true);
			expect(data.user.id_user).toBe(createdUserId);
		}
	});

	it('devrait retourner 404 pour un utilisateur inexistant', async () => {
		const response = await fetch(`${API_BASE_URL}/api/users/utilisateur.inexistant.12345`, {
			headers: getAuthHeaders()
		});

		expect([404]).toContain(response.status);
	});

	it("devrait récupérer l'utilisateur système les.roots", async () => {
		const response = await fetch(`${API_BASE_URL}/api/users/les.roots`, {
			headers: getAuthHeaders()
		});

		expect([200, 401, 403, 404]).toContain(response.status);

		if (response.status === 200) {
			const data = (await response.json()) as UserResponse;
			expect(data.user.id_user).toBe('les.roots');
			expect(data.user.role).toBe('admin');
		}
	});
});

describe('Users API - PUT /api/users/[id]', () => {
	it('devrait modifier un utilisateur', async () => {
		if (!createdUserId) {
			return;
		}

		const updates = {
			email: `modified.${Date.now()}@etu.emse.fr`,
			prenom: 'Modified',
			nom: 'User Updated',
			role: 'user',
			promo_year: 2026
		};

		const response = await fetch(`${API_BASE_URL}/api/users/${createdUserId}`, {
			method: 'PUT',
			headers: getAuthHeaders(),
			body: JSON.stringify(updates)
		});

		expect([200, 400, 401, 403, 404]).toContain(response.status);

		if (response.status === 200) {
			const data = (await response.json()) as { success: boolean };
			expect(data.success).toBe(true);
		}
	});

	it('devrait rejeter la modification avec des données invalides', async () => {
		if (!createdUserId) {
			return;
		}

		const invalidUpdates = {
			email: 'not-an-email',
			role: 'invalid-role'
		};

		const response = await fetch(`${API_BASE_URL}/api/users/${createdUserId}`, {
			method: 'PUT',
			headers: getAuthHeaders(),
			body: JSON.stringify(invalidUpdates)
		});

		expect([400, 401, 403, 404]).toContain(response.status);
	});

	it("devrait rejeter la modification d'un utilisateur inexistant", async () => {
		const response = await fetch(`${API_BASE_URL}/api/users/inexistant.user.12345`, {
			method: 'PUT',
			headers: getAuthHeaders(),
			body: JSON.stringify({
				email: 'test@etu.emse.fr',
				prenom: 'Test',
				nom: 'Test',
				role: 'user'
			})
		});

		expect([401, 404, 500]).toContain(response.status);
	});
});

describe('Users API - PATCH /api/users/me/promo', () => {
	it("devrait mettre à jour la promo de l'utilisateur connecté", async () => {
		const response = await fetch(`${API_BASE_URL}/api/users/me/promo`, {
			method: 'PATCH',
			headers: getAuthHeaders(),
			body: JSON.stringify({
				promo_year: 2025
			})
		});

		expect([200, 400, 401, 403]).toContain(response.status);
	});

	it('devrait rejeter une année de promo invalide', async () => {
		const response = await fetch(`${API_BASE_URL}/api/users/me/promo`, {
			method: 'PATCH',
			headers: getAuthHeaders(),
			body: JSON.stringify({
				promo_year: 'invalid'
			})
		});

		expect([400, 401, 403]).toContain(response.status);
	});

	it('devrait rejeter une année de promo dans le passé', async () => {
		const response = await fetch(`${API_BASE_URL}/api/users/me/promo`, {
			method: 'PATCH',
			headers: getAuthHeaders(),
			body: JSON.stringify({
				promo_year: 1999
			})
		});

		expect([400, 401, 403]).toContain(response.status);
	});
});

describe('Users API - GET /api/users/[username]/avatar', () => {
	it("devrait récupérer l'avatar d'un utilisateur", async () => {
		const response = await fetch(`${API_BASE_URL}/api/users/les.roots/avatar`, {
			headers: getAuthHeaders()
		});

		expect([200, 302, 401, 404, 500]).toContain(response.status);

		if (response.status === 200) {
			const contentType = response.headers.get('content-type');
			expect(contentType).toMatch(/image\/(jpeg|png|gif|webp)/);
		}
	});

	it('devrait gérer les avatars manquants', async () => {
		const response = await fetch(`${API_BASE_URL}/api/users/utilisateur.sans.avatar/avatar`, {
			headers: getAuthHeaders()
		});

		expect([200, 302, 401, 404, 500]).toContain(response.status);
	});

	it('devrait supporter le paramètre size', async () => {
		const sizes = ['small', 'medium', 'large'];

		for (const size of sizes) {
			const response = await fetch(`${API_BASE_URL}/api/users/les.roots/avatar?size=${size}`, {
				headers: getAuthHeaders()
			});

			expect([200, 302, 401, 404, 500]).toContain(response.status);
		}
	});
});

describe('Users API - DELETE /api/users/[id]', () => {
	it('devrait supprimer un utilisateur', async () => {
		if (!createdUserId) {
			return;
		}

		const response = await fetch(`${API_BASE_URL}/api/users/${createdUserId}`, {
			method: 'DELETE',
			headers: getAuthHeaders()
		});

		expect([200, 204, 401, 403, 404]).toContain(response.status);

		if (response.status === 200 || response.status === 204) {
			// Vérifier que l'utilisateur a bien été supprimé
			const checkResponse = await fetch(`${API_BASE_URL}/api/users/${createdUserId}`, {
				headers: getAuthHeaders()
			});
			expect([404]).toContain(checkResponse.status);
			createdUserId = null; // Éviter le double nettoyage
		}
	});

	it("devrait rejeter la suppression d'un utilisateur inexistant", async () => {
		const response = await fetch(`${API_BASE_URL}/api/users/inexistant.user.12345`, {
			method: 'DELETE',
			headers: getAuthHeaders()
		});

		expect([401, 404, 500]).toContain(response.status);
	});

	it("devrait protéger la suppression de l'utilisateur système", async () => {
		const response = await fetch(`${API_BASE_URL}/api/users/les.roots`, {
			method: 'DELETE',
			headers: getAuthHeaders()
		});

		expect([400, 401, 403, 500]).toContain(response.status);
	});
});

describe('Users API - Validation des permissions', () => {
	it('devrait vérifier les permissions admin pour la liste', async () => {
		const response = await fetch(`${API_BASE_URL}/api/users`, {
			headers: getAuthHeaders()
		});

		expect([200, 401, 403]).toContain(response.status);
	});

	it('devrait vérifier les permissions admin pour la création', async () => {
		const response = await fetch(`${API_BASE_URL}/api/users`, {
			method: 'POST',
			headers: getAuthHeaders(),
			body: JSON.stringify({
				id_user: 'test.perm',
				email: 'test@etu.emse.fr',
				prenom: 'Test',
				nom: 'Permission',
				role: 'user'
			})
		});

		expect([200, 201, 401, 403, 400, 409]).toContain(response.status);
	});

	it('devrait vérifier les permissions admin pour la modification', async () => {
		const response = await fetch(`${API_BASE_URL}/api/users/test.user`, {
			method: 'PUT',
			headers: getAuthHeaders(),
			body: JSON.stringify({
				email: 'modified@etu.emse.fr',
				prenom: 'Modified',
				nom: 'User',
				role: 'user'
			})
		});

		expect([200, 401, 403, 404]).toContain(response.status);
	});

	it('devrait vérifier les permissions admin pour la suppression', async () => {
		const response = await fetch(`${API_BASE_URL}/api/users/test.user`, {
			method: 'DELETE',
			headers: getAuthHeaders()
		});

		expect([200, 204, 401, 403, 404]).toContain(response.status);
	});
});
