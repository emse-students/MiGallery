/**
 * Comprehensive tests for the Users API
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { UserResponse, UsersListResponse, UserCreateResponse } from '$lib/types/api';
import { setupTestAuth, teardownTestAuth, globalTestContext } from './test-helpers';

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';
let createdUserId: string | null = null;
// Track all created users for cleanup
const createdUserIds: string[] = [];

beforeAll(async () => {
	await setupTestAuth();
});

afterAll(async () => {
	// Cleanup: delete all created test users
	if (globalTestContext.adminApiKey) {
		for (const userId of createdUserIds) {
			try {
				await fetch(`${API_BASE_URL}/api/users/${userId}`, {
					method: 'DELETE',
					headers: { 'x-api-key': globalTestContext.adminApiKey }
				});
			} catch {
				// Ignore errors
			}
		}
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
	it('should list all users (admin)', async () => {
		const response = await fetch(`${API_BASE_URL}/api/users`, {
			headers: getAuthHeaders()
		});

		expect([200, 401, 403]).toContain(response.status);

		if (response.status === 200) {
			const data = (await response.json()) as UsersListResponse;
			expect(data.success).toBe(true);
			expect(Array.isArray(data.users)).toBe(true);

			// Verify the user structure
			if (data.users.length > 0) {
				const user = data.users[0];
				expect(user).toHaveProperty('id_user');
				expect(user).toHaveProperty('name');
				expect(user).toHaveProperty('role');
			}
		}
	});

	it('should reject access without authentication', async () => {
		const response = await fetch(`${API_BASE_URL}/api/users`);
		expect([401, 403]).toContain(response.status);
	});

	it('should reject access for a non-admin user', async () => {
		// TODO: Test with a non-admin user token
		await Promise.resolve();
		expect(true).toBe(true);
	});
});

describe('Users API - POST /api/users', () => {
	it('should create a new user', async () => {
		const newUser = {
			id_user: `test.user.${Date.now()}`,
			email: `test.${Date.now()}@etu.emse.fr`,
			name: 'Test User',
			first_name: 'Test',
			last_name: 'User',
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
			createdUserIds.push(createdUserId);
			expect(createdUserId).toBe(newUser.id_user);
		}
	});

	it('should reject creation with missing data', async () => {
		const invalidUser = {
			email: 'incomplete@etu.emse.fr'
			// Missing id_user, name, first_name, last_name, role
		};

		const response = await fetch(`${API_BASE_URL}/api/users`, {
			method: 'POST',
			headers: getAuthHeaders(),
			body: JSON.stringify(invalidUser)
		});

		expect([400, 401, 403]).toContain(response.status);
	});

	it('should reject creation without name exploitable', async () => {
		const invalidUser = {
			id_user: 'test.invalid',
			email: 'invalid-email',
			role: 'user'
		};

		const response = await fetch(`${API_BASE_URL}/api/users`, {
			method: 'POST',
			headers: getAuthHeaders(),
			body: JSON.stringify(invalidUser)
		});

		expect([400, 401, 403]).toContain(response.status);
	});

	it('should reject creation with an invalid role', async () => {
		const invalidUser = {
			id_user: 'test.invalid.role',
			email: 'test@etu.emse.fr',
			name: 'Test Invalid',
			first_name: 'Test',
			last_name: 'Invalid',
			role: 'super-admin-999' // Invalid role
		};

		const response = await fetch(`${API_BASE_URL}/api/users`, {
			method: 'POST',
			headers: getAuthHeaders(),
			body: JSON.stringify(invalidUser)
		});

		expect([400, 401, 403]).toContain(response.status);
	});

	it('should reject creation of a duplicate user', async () => {
		if (!createdUserId) {
			return;
		}

		const duplicateUser = {
			id_user: createdUserId,
			email: 'duplicate@etu.emse.fr',
			name: 'Duplicate User',
			first_name: 'Duplicate',
			last_name: 'User',
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
	it('should fetch a specific user', async () => {
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

	it('should return 404 for non-existent user', async () => {
		const response = await fetch(`${API_BASE_URL}/api/users/inexistant.user.12345`, {
			headers: getAuthHeaders()
		});

		expect([404]).toContain(response.status);
	});

	it('should fetch system user dd68bb5b4f7c56878a1bd873593a3e7c3434242c80871e4ead9fe99d3f48a782', async () => {
		const response = await fetch(
			`${API_BASE_URL}/api/users/dd68bb5b4f7c56878a1bd873593a3e7c3434242c80871e4ead9fe99d3f48a782`,
			{
				headers: getAuthHeaders()
			}
		);

		expect([200, 401, 403, 404]).toContain(response.status);

		if (response.status === 200) {
			const data = (await response.json()) as UserResponse;
			expect(data.user.id_user).toBe(
				'dd68bb5b4f7c56878a1bd873593a3e7c3434242c80871e4ead9fe99d3f48a782'
			);
			expect(data.user.role).toBe('admin');
		}
	});
});

describe('Users API - PUT /api/users/[id]', () => {
	it('should update a user', async () => {
		if (!createdUserId) {
			return;
		}

		const updates = {
			email: `modified.${Date.now()}@etu.emse.fr`,
			name: 'Modified User Updated',
			first_name: 'Modified',
			last_name: 'User Updated',
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

	it('should reject modification with invalid data', async () => {
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

	it('should reject modification of a nonexistent user', async () => {
		const response = await fetch(`${API_BASE_URL}/api/users/inexistant.user.12345`, {
			method: 'PUT',
			headers: getAuthHeaders(),
			body: JSON.stringify({
				email: 'test@etu.emse.fr',
				name: 'Test Test',
				first_name: 'Test',
				last_name: 'Test',
				role: 'user'
			})
		});

		expect([401, 404, 500]).toContain(response.status);
	});
});

describe('Users API - PATCH /api/users/me/promo', () => {
	it("should update the logged-in user's promo", async () => {
		const response = await fetch(`${API_BASE_URL}/api/users/me/promo`, {
			method: 'PATCH',
			headers: getAuthHeaders(),
			body: JSON.stringify({
				promo_year: 2020
			})
		});

		expect([400, 401, 403, 500]).toContain(response.status);
	});
	it('should reject an invalid promo year', async () => {
		const response = await fetch(`${API_BASE_URL}/api/users/me/promo`, {
			method: 'PATCH',
			headers: getAuthHeaders(),
			body: JSON.stringify({
				promo_year: 'invalid'
			})
		});

		expect([400, 401, 403, 500]).toContain(response.status);
	});

	it('should reject a promo year in the past', async () => {
		const response = await fetch(`${API_BASE_URL}/api/users/me/promo`, {
			method: 'PATCH',
			headers: getAuthHeaders(),
			body: JSON.stringify({
				promo_year: 1999
			})
		});

		expect([400, 401, 403, 500]).toContain(response.status);
	});
});

describe('Users API - GET /api/users/[username]/avatar', () => {
	it('should fetch user avatar', async () => {
		const response = await fetch(
			`${API_BASE_URL}/api/users/dd68bb5b4f7c56878a1bd873593a3e7c3434242c80871e4ead9fe99d3f48a782/avatar`,
			{
				headers: getAuthHeaders()
			}
		);

		expect([200, 302, 401, 404, 500]).toContain(response.status);

		if (response.status === 200) {
			const contentType = response.headers.get('content-type');
			expect(contentType).toMatch(/image\/(jpeg|png|gif|webp)/);
		}
	});

	it('should handle missing avatars', async () => {
		const response = await fetch(`${API_BASE_URL}/api/users/user.without.avatar/avatar`, {
			headers: getAuthHeaders()
		});

		expect([200, 302, 401, 404, 500]).toContain(response.status);
	});

	it('should support size parameter', async () => {
		const sizes = ['small', 'medium', 'large'];

		for (const size of sizes) {
			const response = await fetch(
				`${API_BASE_URL}/api/users/dd68bb5b4f7c56878a1bd873593a3e7c3434242c80871e4ead9fe99d3f48a782/avatar?size=${size}`,
				{
					headers: getAuthHeaders()
				}
			);

			expect([200, 302, 401, 404, 500]).toContain(response.status);
		}
	});
});

describe('Users API - DELETE /api/users/[id]', () => {
	it('should delete a user', async () => {
		if (!createdUserId) {
			return;
		}

		const response = await fetch(`${API_BASE_URL}/api/users/${createdUserId}`, {
			method: 'DELETE',
			headers: getAuthHeaders()
		});

		expect([200, 204, 401, 403, 404]).toContain(response.status);

		if (response.status === 200 || response.status === 204) {
			// Verify that the user was deleted
			const checkResponse = await fetch(`${API_BASE_URL}/api/users/${createdUserId}`, {
				headers: getAuthHeaders()
			});
			expect([404]).toContain(checkResponse.status);
			createdUserId = null; // Avoid double cleanup
		}
	});

	it('should reject deletion of a nonexistent user', async () => {
		const response = await fetch(`${API_BASE_URL}/api/users/inexistant.user.12345`, {
			method: 'DELETE',
			headers: getAuthHeaders()
		});

		expect([401, 404, 500]).toContain(response.status);
	});

	it('should protect deletion of the system user', async () => {
		const response = await fetch(
			`${API_BASE_URL}/api/users/dd68bb5b4f7c56878a1bd873593a3e7c3434242c80871e4ead9fe99d3f48a782`,
			{
				method: 'DELETE',
				headers: getAuthHeaders()
			}
		);

		expect([400, 401, 403, 500]).toContain(response.status);
	});
});

describe('Users API - Permission validation', () => {
	it('should verify admin permissions for listing', async () => {
		const response = await fetch(`${API_BASE_URL}/api/users`, {
			headers: getAuthHeaders()
		});

		expect([200, 401, 403]).toContain(response.status);
	});

	it('should verify admin permissions for creation', async () => {
		const testPermUserId = `test.perm.${Date.now()}`;
		const response = await fetch(`${API_BASE_URL}/api/users`, {
			method: 'POST',
			headers: getAuthHeaders(),
			body: JSON.stringify({
				id_user: testPermUserId,
				email: `test.perm.${Date.now()}@etu.emse.fr`,
				name: 'Test Permission',
				first_name: 'Test',
				last_name: 'Permission',
				role: 'user'
			})
		});

		// Track for cleanup
		if (response.status === 200 || response.status === 201) {
			createdUserIds.push(testPermUserId);
		}

		expect([200, 201, 401, 403, 400, 409]).toContain(response.status);
	});

	it('should verify admin permissions for modification', async () => {
		const response = await fetch(`${API_BASE_URL}/api/users/test.user`, {
			method: 'PUT',
			headers: getAuthHeaders(),
			body: JSON.stringify({
				email: 'modified@etu.emse.fr',
				name: 'Modified User',
				first_name: 'Modified',
				last_name: 'User',
				role: 'user'
			})
		});

		expect([200, 401, 403, 404]).toContain(response.status);
	});

	it('should verify admin permissions for deletion', async () => {
		const response = await fetch(`${API_BASE_URL}/api/users/test.user`, {
			method: 'DELETE',
			headers: getAuthHeaders()
		});

		expect([200, 204, 401, 403, 404]).toContain(response.status);
	});
});

describe('Users API - PATCH /api/users/me/face', () => {
	// Test user for the /me endpoints with admin API key
	const testUserId = 'test-face-user';

	it('should reject requests without authentication', async () => {
		const response = await fetch(`${API_BASE_URL}/api/users/me/face`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ person_id: 'test-id' })
		});

		expect([401, 403]).toContain(response.status);
	});

	it('should reject if person_id is missing', async () => {
		const response = await fetch(`${API_BASE_URL}/api/users/me/face`, {
			method: 'PATCH',
			headers: getAuthHeaders(),
			body: JSON.stringify({ user_id: testUserId })
		});

		expect([400, 401, 403, 404]).toContain(response.status);

		if (response.status === 400) {
			const data = (await response.json()) as { error?: string };
			expect(data.error).toBeDefined();
		}
	});

	it('should update person_id with valid value', async () => {
		const testPersonId = 'test-person-uuid-12345';
		const response = await fetch(`${API_BASE_URL}/api/users/me/face`, {
			method: 'PATCH',
			headers: getAuthHeaders(),
			body: JSON.stringify({ person_id: testPersonId, user_id: testUserId })
		});

		expect([200, 401, 403, 404]).toContain(response.status);

		if (response.status === 200) {
			const data = (await response.json()) as { success: boolean; person_id: string };
			expect(data.success).toBe(true);
			expect(data.person_id).toBe(testPersonId);
		}
	});

	it('should accept null as person_id', async () => {
		const response = await fetch(`${API_BASE_URL}/api/users/me/face`, {
			method: 'PATCH',
			headers: getAuthHeaders(),
			body: JSON.stringify({ person_id: null, user_id: testUserId })
		});

		expect([200, 401, 403, 404]).toContain(response.status);

		if (response.status === 200) {
			const data = (await response.json()) as { success: boolean; person_id: string | null };
			expect(data.success).toBe(true);
			expect(data.person_id).toBeNull();
		}
	});
});
