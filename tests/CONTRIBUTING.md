# 🧪 Test Contribution Guide

This guide explains how to add, modify, and maintain MiGallery tests.

## 📋 Table of Contents

- [Basic Principles](#basic-principles)
- [Test Structure](#test-structure)
- [Adding a New Test](#adding-a-new-test)
- [Helpers and Utilities](#helpers-and-utilities)
- [Best Practices](#best-practices)
- [Debugging](#debugging)

---

## Basic Principles

### File Organization

Tests are organized by **functional domain**:

```
tests/
├── albums.test.ts              # Albums API tests
├── users.test.ts               # Users API tests
├── favorites-external.test.ts  # Favorites & External Media tests
├── admin-auth.test.ts          # Admin & Authentication tests
├── people-photoscv.test.ts     # People & Photos-CV tests
├── immich-proxy.test.ts        # Immich Proxy tests
├── e2e-integration.test.ts     # End-to-End tests
├── test-helpers.ts             # Configuration and helpers
└── README.md                   # Documentation
```

### Naming Conventions

- **Files**: `{domain}.test.ts`
- **Describe blocks**: `{Domain} API - {Method} {Endpoint}`
- **Tests**: `should {expected action}`

### Example

```typescript
describe('Albums API - GET /api/albums', () => {
  it('should list all albums', async () => {
    // Test here
  });
});
```

---

## Test Structure

### Basic Template

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getAuthHeaders, TEST_CONFIG } from './test-helpers';

const API_BASE_URL = TEST_CONFIG.API_BASE_URL;
let API_KEY = '';

beforeAll(async () => {
  // Setup: create necessary resources
});

afterAll(async () => {
  // Cleanup: delete created resources
});

describe('My Domain API - GET /api/my-endpoint', () => {
  it('should do something', async () => {
    const response = await fetch(`${API_BASE_URL}/api/my-endpoint`, {
      headers: getAuthHeaders(API_KEY),
    });

    expect([200, 401]).toContain(response.status);

    if (response.status === 200) {
      const data = await response.json();
      expect(data).toBeDefined();
    }
  });
});
```

---

## Adding a New Test

### 1. Choose the appropriate file

**Question**: Which feature does my test concern?

- Albums → `albums.test.ts`
- Users → `users.test.ts`
- Favorites/External Media → `favorites-external.test.ts`
- Admin/Auth → `admin-auth.test.ts`
- People/Photos-CV → `people-photoscv.test.ts`
- Immich Proxy → `immich-proxy.test.ts`
- Complete workflow → `e2e-integration.test.ts`
- New feature → Create a new file

### 2. Create the describe block

```typescript
describe('My Domain API - {Method} {Endpoint}', () => {
  // Tests here
});
```

### 3. Add tests

```typescript
it('should {expected action}', async () => {
  // 1. Prepare data
  const requestData = {/* ... */};

  // 2. Make the request
  const response = await fetch(`${API_BASE_URL}/api/endpoint`, {
    method: 'POST',
    headers: getAuthHeaders(API_KEY),
    body: JSON.stringify(requestData),
  });

  // 3. Check the response
  expect([200, 201, 400, 401]).toContain(response.status);

  // 4. Check data (if success)
  if (response.status === 200 || response.status === 201) {
    const data = await response.json();
    expect(data).toHaveProperty('id');
    expect(data.name).toBe('test');
  }
});
```

### 4. Add cleanup

```typescript
afterAll(async () => {
  // Delete resources created during tests
  if (createdResourceId) {
    await fetch(`${API_BASE_URL}/api/resource/${createdResourceId}`, {
      method: 'DELETE',
      headers: getAuthHeaders(API_KEY),
    });
  }
});
```

---

## Helpers and Utilities

### Using `test-helpers.ts`

```typescript
import {
  getAuthHeaders,
  generateTestUser,
  handleImmichError,
  cleanupResource,
  TEST_CONFIG,
} from './test-helpers';

// Authentication headers
const headers = getAuthHeaders(apiKey);

// Generate a unique test user
const user = generateTestUser('mytest');
// → { id_user: 'mytest.user.1234567890', email: '...', ... }

// Handle Immich errors
try {
  const response = await fetch('...');
} catch (error) {
  if (handleImmichError(error)) {
    // Immich unavailable, test still passes
    return;
  }
  throw error;
}

// Clean up a resource
await cleanupResource(TEST_CONFIG.API_BASE_URL + '/api/albums', apiKey, albumId);
```

### Creating a new helper

If you need a reusable helper, add it to `test-helpers.ts`:

```typescript
/**
 * Helper to create a test album
 */
export async function createTestAlbum(apiKey: string, name?: string): Promise<string> {
  const albumName = name || `Test Album ${Date.now()}`;

  const response = await fetch(`${TEST_CONFIG.API_BASE_URL}/api/albums`, {
    method: 'POST',
    headers: getAuthHeaders(apiKey),
    body: JSON.stringify({ albumName }),
  });

  if (!response.ok) {
    throw new Error('Failed to create test album');
  }

  const album = await response.json();
  return album.id;
}
```

---

## Best Practices

### ✅ DO

1. **Use helpers** to avoid duplication
2. **Test all cases**: success, errors, edge cases
3. **Clean up resources** in `afterAll()`
4. **Handle external services** (Immich) with timeouts and retry
5. **Document complex tests** with comments
6. **Use unique data** (timestamp, random) to avoid conflicts

### ❌ DON'T

1. **Don't hardcode IDs** → Use variables or generate
2. **Don't leave resources behind** → Always clean up
3. **Don't ignore errors** → Check status codes
4. **Don't duplicate code** → Use helpers
5. **Don't make overly long tests** → Split into multiple tests

### Best practices example

```typescript
describe('Albums API - POST /api/albums', () => {
  let createdAlbumId: string | null = null;

  afterAll(async () => {
    // ✅ Automatic cleanup
    if (createdAlbumId) {
      await cleanupResource(`${API_BASE_URL}/api/albums`, API_KEY, createdAlbumId);
    }
  });

  it('should create an album', async () => {
    // ✅ Unique data
    const albumData = {
      albumName: `Test Album ${Date.now()}`,
      description: 'Created by tests',
    };

    const response = await fetch(`${API_BASE_URL}/api/albums`, {
      method: 'POST',
      headers: getAuthHeaders(API_KEY), // ✅ Helper
      body: JSON.stringify(albumData),
    });

    // ✅ Check multiple possible statuses
    expect([200, 201, 400, 401]).toContain(response.status);

    // ✅ Save ID for cleanup
    if (response.ok) {
      const album = await response.json();
      createdAlbumId = album.id;
      expect(album.albumName).toBe(albumData.albumName);
    }
  });

  it('should reject an album without a name', async () => {
    const response = await fetch(`${API_BASE_URL}/api/albums`, {
      method: 'POST',
      headers: getAuthHeaders(API_KEY),
      body: JSON.stringify({ description: 'No name' }),
    });

    // ✅ Test error cases
    expect([400, 401]).toContain(response.status);
  });
});
```

---

## Debugging

### View detailed logs

```bash
# Run tests with more details
bunx vitest run --reporter=verbose

# Run a single test file
bunx vitest run tests/albums.test.ts

# Run a single test (use .only)
it.only('should do something', async () => { /* ... */ });
```

### Inspect responses

```typescript
it('should return data', async () => {
  const response = await fetch(`${API_BASE_URL}/api/endpoint`);

  // Display response for debugging
  console.log('Status:', response.status);
  console.log('Headers:', Object.fromEntries(response.headers));

  const data = await response.json();
  console.log('Data:', JSON.stringify(data, null, 2));

  expect(response.status).toBe(200);
});
```

### Common Issues

#### ❌ Timeout Error

**Cause**: Server or Immich not responding fast enough

**Solution**:

```typescript
// Increase test timeout
it('should do something', async () => {
  // ...
}, 30000); // 30 seconds

// Or handle Immich error
try {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(10000),
  });
} catch (error) {
  if (handleImmichError(error)) {
    return; // Test still passes
  }
  throw error;
}
```

#### ❌ Test fails intermittently

**Cause**: Shared data, race conditions, external services

**Solution**:

```typescript
// 1. Use unique data
const userId = `test.user.${Date.now()}.${Math.random()}`;

// 2. Clean before AND after
beforeAll(async () => {
  // Clean old resources
});

afterAll(async () => {
  // Clean new resources
});

// 3. Configure retry in vitest.config.ts
test: {
  retry: 1; // Retry once on failure
}
```

#### ❌ Resources not cleaned up

**Cause**: Error before cleanup or failed cleanup

**Solution**:

```typescript
afterAll(async () => {
  // Robust cleanup
  if (createdUserId) {
    try {
      await fetch(`${API_BASE_URL}/api/users/${createdUserId}`, {
        method: 'DELETE',
        headers: getAuthHeaders(API_KEY),
      });
    } catch (error) {
      console.warn('Cleanup failed:', error);
      // Don't throw, continue cleanup
    }
    createdUserId = null;
  }
});
```

---

## Complete Examples

### Simple test (GET)

```typescript
it('should list albums', async () => {
  const response = await fetch(`${API_BASE_URL}/api/albums`, {
    headers: getAuthHeaders(API_KEY),
  });

  expect([200, 401]).toContain(response.status);

  if (response.status === 200) {
    const albums = await response.json();
    expect(Array.isArray(albums)).toBe(true);
  }
});
```

### Test with creation (POST)

```typescript
let createdAlbumId: string | null = null;

afterAll(async () => {
  if (createdAlbumId) {
    await cleanupResource(`${API_BASE_URL}/api/albums`, API_KEY, createdAlbumId);
  }
});

it('should create an album', async () => {
  const response = await fetch(`${API_BASE_URL}/api/albums`, {
    method: 'POST',
    headers: getAuthHeaders(API_KEY),
    body: JSON.stringify({
      albumName: `Test ${Date.now()}`,
    }),
  });

  expect([200, 201]).toContain(response.status);

  if (response.ok) {
    const album = await response.json();
    createdAlbumId = album.id;
    expect(album.id).toBeDefined();
  }
});
```

### Test with Immich timeout

```typescript
it('should handle Immich unavailable', async () => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/people/people`, {
      headers: getAuthHeaders(API_KEY),
      signal: AbortSignal.timeout(10000),
    });

    expect([200, 404, 500, 502]).toContain(response.status);
  } catch (error) {
    if (handleImmichError(error)) {
      return; // OK, Immich down
    }
    throw error;
  }
}, 15000);
```

---

## Pre-commit Checklist

- [ ] Tests pass locally (`bun run test`)
- [ ] Resources are cleaned up (no leaks)
- [ ] Timeouts are appropriate
- [ ] Error cases are tested
- [ ] Helpers are used when possible
- [ ] Code is commented if necessary
- [ ] Documentation is up to date

---

## Questions?

- 📖 See `tests/README.md` for complete documentation
- 🔍 Look at existing tests as examples
- 💬 Ask the team for help

**Happy Testing! 🧪**
