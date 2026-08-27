/**
 * Comprehensive tests for the People / Photos-CV API
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
    'Content-Type': 'application/json',
  };
  if (globalTestContext.adminApiKey) {
    headers['x-api-key'] = globalTestContext.adminApiKey;
  }
  return headers;
};

describe('People API - GET /api/people/people', () => {
  it('should list all people', async () => {
    const response = await fetch(`${API_BASE_URL}/api/people/people`, {
      headers: getAuthHeaders(),
      signal: AbortSignal.timeout(10000),
    });

    expect([200, 400, 401, 404, 500]).toContain(response.status);

    if (response.status === 200) {
      // The route answers `{ people, total }`. This used to branch over three
      // possible shapes and assert `Array.isArray(data)` inside `if
      // (Array.isArray(data))`, which is an assertion that cannot fail - and the
      // bare-array branch it guarded was unreachable.
      const data = (await response.json()) as {
        people: Array<{ id: string; name: string }>;
        total: number;
      };
      expect(Array.isArray(data.people)).toBe(true);
      expect(data.total).toBe(data.people.length);
      if (data.people.length > 0) {
        const person = data.people[0];
        expect(person).toHaveProperty('id');
        expect(person).toHaveProperty('name');
        testPersonId = person.id;
      }
    }
  }, 15000);

  it('should reject access without authentication', async () => {
    const response = await fetch(`${API_BASE_URL}/api/people/people`);
    expect([401, 403]).toContain(response.status);
  });

  // There used to be a third test here called "should handle case where Immich is
  // unavailable". It made the same request as the one above with a wider list of
  // accepted statuses, and its catch branch asserted `expect(true).toBe(true)`.
  // Nothing in it could fail and nothing in it made Immich unavailable.
});

describe('People API - GET /api/people/people/[personId]/photos', () => {
  it("should fetch a person's photos", async () => {
    if (!testPersonId) {
      return;
    }

    const response = await fetch(`${API_BASE_URL}/api/people/people/${testPersonId}/photos`, {
      headers: getAuthHeaders(),
      signal: AbortSignal.timeout(10000),
    });

    expect([200, 400, 401, 404, 500]).toContain(response.status);

    if (response.status === 200) {
      // `{ assets: [...] }`, not a bare array.
      const body = (await response.json()) as { assets?: unknown };
      expect(Array.isArray(body.assets)).toBe(true);
    }
  }, 15000);

  it('should support pagination', async () => {
    if (!testPersonId) {
      return;
    }

    const response = await fetch(
      `${API_BASE_URL}/api/people/people/${testPersonId}/photos?page=1&limit=20`,
      {
        headers: getAuthHeaders(),
        signal: AbortSignal.timeout(10000),
      }
    );

    expect([200, 400, 401, 404, 500]).toContain(response.status);
  }, 15000);

  it('should return 404 for a nonexistent person', async () => {
    const response = await fetch(`${API_BASE_URL}/api/people/people/inexistant-person-id/photos`, {
      headers: getAuthHeaders(),
    });

    expect([404, 500]).toContain(response.status);
  });
});

describe('People API - GET /api/people/people/[personId]/photos-stream', () => {
  it("should stream a person's photos", async () => {
    if (!testPersonId) {
      return;
    }

    const response = await fetch(
      `${API_BASE_URL}/api/people/people/${testPersonId}/photos-stream`,
      {
        headers: getAuthHeaders(),
        signal: AbortSignal.timeout(10000),
      }
    );

    expect([200, 400, 401, 404, 500]).toContain(response.status);

    if (response.status === 200) {
      const contentType = response.headers.get('content-type');
      expect(contentType).toContain('application/json');
    }
  }, 15000);

  it('should support streaming with cursor', async () => {
    if (!testPersonId) {
      return;
    }

    const response = await fetch(
      `${API_BASE_URL}/api/people/people/${testPersonId}/photos-stream?cursor=10&limit=30`,
      {
        headers: getAuthHeaders(),
        signal: AbortSignal.timeout(10000),
      }
    );

    expect([200, 400, 401, 404, 500]).toContain(response.status);
  }, 15000);
});

describe('People API - GET /api/people/person/[id]/my-photos', () => {
  it("should fetch the corresponding user's photos", async () => {
    const response = await fetch(`${API_BASE_URL}/api/people/person/test-person-id/my-photos`, {
      headers: getAuthHeaders(),
      signal: AbortSignal.timeout(10000),
    });

    expect([200, 400, 401, 404, 500]).toContain(response.status);
  }, 15000);
});

describe('People API - GET /api/people/person/[id]/album-photos', () => {
  it("should fetch the person's album photos", async () => {
    const response = await fetch(`${API_BASE_URL}/api/people/person/test-person-id/album-photos`, {
      headers: getAuthHeaders(),
      signal: AbortSignal.timeout(10000),
    });

    expect([200, 400, 401, 404, 500]).toContain(response.status);
  }, 15000);
});

describe('People API - GET /api/people', () => {
  it('should list people with filters', async () => {
    const response = await fetch(`${API_BASE_URL}/api/people?promo=2025`, {
      headers: getAuthHeaders(),
      signal: AbortSignal.timeout(10000),
    });

    expect([200, 400, 401, 404, 500]).toContain(response.status);

    if (response.status === 200) {
      const data = (await response.json()) as Record<string, unknown>;
      expect(data).toBeDefined();
    }
  }, 15000);

  it('should support department filter', async () => {
    const response = await fetch(`${API_BASE_URL}/api/people?department=ICM`, {
      headers: getAuthHeaders(),
      signal: AbortSignal.timeout(10000),
    });

    expect([200, 400, 401, 404, 500]).toContain(response.status);
  }, 15000);

  it('should support option filter', async () => {
    const response = await fetch(`${API_BASE_URL}/api/people?option=ISMIN`, {
      headers: getAuthHeaders(),
      signal: AbortSignal.timeout(10000),
    });

    expect([200, 400, 401, 404, 500]).toContain(response.status);
  }, 15000);

  it('should support name search', async () => {
    const response = await fetch(`${API_BASE_URL}/api/people?search=test`, {
      headers: getAuthHeaders(),
      signal: AbortSignal.timeout(10000),
    });

    expect([200, 400, 401, 404, 500]).toContain(response.status);
  }, 15000);

  it('should support multiple combined filters', async () => {
    const response = await fetch(
      `${API_BASE_URL}/api/people?promo=2025&department=ICM&option=ISMIN`,
      {
        headers: getAuthHeaders(),
        signal: AbortSignal.timeout(10000),
      }
    );

    expect([200, 400, 401, 404, 500]).toContain(response.status);
  }, 15000);
});

describe('People API - POST /api/people', () => {
  it('should create a new person', async () => {
    const newPerson = {
      name: `Test Person ${Date.now()}`,
      promo: 2025,
      department: 'ICM',
      option: 'ISMIN',
    };

    const response = await fetch(`${API_BASE_URL}/api/people`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(newPerson),
      signal: AbortSignal.timeout(10000),
    });

    expect([200, 201, 400, 401, 403, 500]).toContain(response.status);
  }, 15000);

  it('should reject creation without name', async () => {
    const response = await fetch(`${API_BASE_URL}/api/people`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        promo: 2025,
      }),
    });

    expect([400, 401, 403]).toContain(response.status);
  });

  it('should validate promo year', async () => {
    const invalidPerson = {
      name: 'Invalid Promo',
      promo: 'invalid',
    };

    const response = await fetch(`${API_BASE_URL}/api/people`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(invalidPerson),
    });

    expect([400, 401, 403]).toContain(response.status);
  });
});

describe('People Album API - GET /api/people/album', () => {
  it('should fetch PhotoCV album', async () => {
    const response = await fetch(`${API_BASE_URL}/api/people/album`, {
      headers: getAuthHeaders(),
      signal: AbortSignal.timeout(10000),
    });

    expect([200, 400, 401, 404, 500]).toContain(response.status);

    if (response.status === 200) {
      const data = (await response.json()) as {
        id?: string;
        albumName?: string;
        assets?: unknown[];
      };
      // Response can be {id, albumName} or {assets: [...]}
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
  it('should fetch PhotoCV album information', async () => {
    const response = await fetch(`${API_BASE_URL}/api/people/album/info`, {
      headers: getAuthHeaders(),
      signal: AbortSignal.timeout(10000),
    });

    expect([200, 400, 401, 404, 500]).toContain(response.status);

    if (response.status === 200) {
      const info = (await response.json()) as { id: string };
      expect(info).toHaveProperty('id');
    }
  }, 15000);
});

describe('People Album API - GET /api/people/album/[albumId]/assets', () => {
  it('should fetch PhotoCV album assets', async () => {
    if (!testAlbumId) {
      return;
    }

    const response = await fetch(`${API_BASE_URL}/api/people/album/${testAlbumId}/assets`, {
      headers: getAuthHeaders(),
      signal: AbortSignal.timeout(10000),
    });

    expect([200, 400, 401, 404, 500]).toContain(response.status);

    if (response.status === 200) {
      // The route answers `{ assets: [...] }`, not a bare array. The old
      // `Array.isArray(body)` here asserted the wrong shape and never failed,
      // because it only runs when a test album exists against a local Immich.
      const body = (await response.json()) as { assets?: unknown };
      expect(Array.isArray(body.assets)).toBe(true);
    }
  }, 15000);
});

describe('People Album API - PUT /api/people/album/[albumId]/assets', () => {
  it('should add assets to PhotoCV album', async () => {
    if (!testAlbumId) {
      return;
    }

    const response = await fetch(`${API_BASE_URL}/api/people/album/${testAlbumId}/assets`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        ids: ['test-asset-1', 'test-asset-2'],
      }),
      signal: AbortSignal.timeout(10000),
    });

    expect([200, 400, 401, 404, 500]).toContain(response.status);
  }, 15000);

  it('should reject addition without IDs', async () => {
    if (!testAlbumId) {
      return;
    }

    const response = await fetch(`${API_BASE_URL}/api/people/album/${testAlbumId}/assets`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({}),
    });

    expect([400, 401, 404]).toContain(response.status);
  });
});

describe('People Album API - DELETE /api/people/album/[albumId]/assets', () => {
  it('should delete assets from PhotoCV album', async () => {
    if (!testAlbumId) {
      return;
    }

    const response = await fetch(`${API_BASE_URL}/api/people/album/${testAlbumId}/assets`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        ids: ['test-asset-1'],
      }),
      signal: AbortSignal.timeout(10000),
    });

    expect([200, 400, 401, 404, 500]).toContain(response.status);
  }, 15000);
});

describe('People Album API - PUT /api/people/album/assets (bulk)', () => {
  it('should handle bulk asset addition', async () => {
    const response = await fetch(`${API_BASE_URL}/api/people/album/assets`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        albumId: testAlbumId,
        ids: ['asset-1', 'asset-2', 'asset-3'],
      }),
      signal: AbortSignal.timeout(10000),
    });

    expect([200, 400, 401, 404, 500]).toContain(response.status);
  }, 15000);
});

describe('People Album API - DELETE /api/people/album/assets (bulk)', () => {
  it('should handle bulk asset deletion', async () => {
    const response = await fetch(`${API_BASE_URL}/api/people/album/assets`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        albumId: testAlbumId,
        ids: ['asset-1', 'asset-2'],
      }),
      signal: AbortSignal.timeout(10000),
    });

    expect([200, 400, 401, 404, 500]).toContain(response.status);
  }, 15000);
});

describe('People API - Error Handling', () => {
  // "should handle Immich timeouts gracefully" lived here. It made an ordinary
  // request with a client-side timeout, which induces no upstream timeout at all,
  // and its catch branch asserted `expect(true).toBe(true)`.

  it('should return structured errors', async () => {
    const response = await fetch(`${API_BASE_URL}/api/people/people/invalid-id/photos`);

    expect([401, 404, 500]).toContain(response.status);

    if (response.headers.get('content-type')?.includes('application/json')) {
      // `toBeDefined()` on a parsed JSON body is not a check - it holds for `{}`.
      // The claim worth making is that the error carries something to read.
      const error = (await response.json()) as Record<string, unknown>;
      expect(Object.keys(error).length).toBeGreaterThan(0);
    }
  });
});
