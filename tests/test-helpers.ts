/**
 * Shared configuration for all tests
 */

import { rmSync } from 'node:fs';

export const TEST_CONFIG = {
  API_BASE_URL: process.env.API_BASE_URL || 'http://localhost:3000',
  DEFAULT_TIMEOUT: 10000,
  LONG_TIMEOUT: 30000,
  IMMICH_TIMEOUT: 15000,
  // The suite's own admin, written into the run's database by scripts/test-with-server.mjs.
  TEST_ADMIN_ID: 'test-admin',

  // Scope configuration
  SCOPES: {
    READ: 'read',
    WRITE: 'write',
    DELETE: 'delete',
    ADMIN: 'admin',
  },

  // Role configuration
  ROLES: {
    USER: 'user',
    ADMIN: 'admin',
    MODERATOR: 'moderator',
  },

  // Test users
  TEST_USERS: {
    PREFIX: 'test.user.',
  },
};

/**
 * Helper to create authentication headers
 */
/**
 * Remove a temporary directory a test created, and report rather than fail if the OS will not.
 *
 * A teardown is not an assertion. `tests/sso-mirror.test.ts` opens a SQLite file and closes its
 * handle with `close(true)` before deleting the directory, which is correct - and on Windows the
 * lock on the file and its `-wal`/`-shm` siblings is still not released by the time `rmSync` runs,
 * so the whole suite reported a failure for a defect that does not exist. The tests had all passed.
 *
 * So a removal that the platform refuses is LOGGED and the run continues: nothing was asserted
 * about the directory, and `%TEMP%` is reclaimed by the OS. A removal that fails for any other
 * reason is re-thrown, because that is a fact about the test rather than about the filesystem.
 *
 * The warning goes to `console.warn`, which `vitest.config.ts` currently mutes for every test via
 * `onConsoleLog`. That is a repository-wide choice about test noise and not this helper's to make:
 * the line is written on the standard channel, and it appears the moment that setting changes.
 */
export function removeTempDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code !== 'EBUSY' && code !== 'EPERM' && code !== 'ENOTEMPTY') {
      throw e;
    }
    console.warn(
      `[test-helpers] the platform is still holding ${dir} (${code}); leaving it to TEMP.`
    );
  }
}

export function getAuthHeaders(apiKey?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKey) {
    headers['x-api-key'] = apiKey;
  }
  return headers;
}

/**
 * Helper to create a unique test user
 */
export function generateTestUser(prefix = 'test') {
  const timestamp = Date.now();
  return {
    id_user: `${prefix}.user.${timestamp}`,
    name: `Test User ${timestamp}`,
    first_name: 'Test',
    last_name: `User ${timestamp}`,
    role: 'user' as const,
    promo: 2025,
  };
}

/**
 * Helper to handle Immich timeouts
 */
export function handleImmichError(error: unknown): boolean {
  const err = error as { name?: string; code?: string };
  return err.name === 'TimeoutError' || err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT';
}

/**
 * Helper to wait for a service to be ready
 */
export async function waitForService(
  url: string,
  maxRetries = 30,
  retryDelay = 1000
): Promise<boolean> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return true;
      }
    } catch {
      // Service not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, retryDelay));
  }
  return false;
}

/**
 * DELETE a resource the way a real API client must, and FAIL LOUDLY when it is refused.
 *
 * Kit 3 answers 403 to a mutation that carries neither an Origin nor a Content-Type, before any
 * hook runs (see docs/wiki/api-reference.md), so `Content-Type` is part of the call. Cleanup used
 * to swallow every answer, which let that 403 leave test data behind for weeks without a sound.
 * A 404 is fine (already gone); anything else in `accepted` is the caller's stated tolerance.
 */
export async function deleteOrThrow(
  url: string,
  headers: Record<string, string>,
  accepted: readonly number[] = [200, 204, 404]
): Promise<void> {
  const response = await fetch(url, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', ...headers },
  });
  if (!accepted.includes(response.status)) {
    throw new Error(
      `cleanup DELETE ${url} answered ${response.status}, expected one of ${accepted.join('/')}`
    );
  }
}

/**
 * Helper to clean up resources after tests
 */
export async function cleanupResource(
  url: string,
  apiKey: string,
  resourceId: string | null
): Promise<void> {
  if (!resourceId) {
    return;
  }

  await deleteOrThrow(`${url}/${resourceId}`, { 'x-api-key': apiKey });
}

/**
 * Useful types for tests
 */
export interface TestContext {
  adminApiKey: string;
  writeApiKey: string;
  readApiKey: string;
  sessionCookie: string;
  testUserId: string;
  createdResources: {
    users: string[];
    albums: string[];
    apiKeys: string[];
  };
}

/**
 * Shared global test context
 */
export const globalTestContext: Partial<TestContext> = {
  adminApiKey: '',
  writeApiKey: '',
  readApiKey: '',
  sessionCookie: '',
  testUserId: '',
  createdResources: {
    users: [],
    albums: [],
    apiKeys: [],
  },
};

/**
 * Helper to initialize a test context
 */
export function createTestContext(): TestContext {
  return {
    adminApiKey: '',
    writeApiKey: '',
    readApiKey: '',
    sessionCookie: '',
    testUserId: '',
    createdResources: {
      users: [],
      albums: [],
      apiKeys: [],
    },
  };
}

/**
 * Open the test run's SQLite file (`MIGALLERY_TEST_DATABASE`, the same file the test server was
 * started on) with the SAME driver the application uses. Throws when that variable is unset
 * rather than guessing a path: the only other candidates are the developer's own databases.
 *
 * `bun:sqlite`, not better-sqlite3: a test that opens the database through a different driver than
 * production proves nothing about production. The interface below is structural on purpose, so no
 * bun type package is needed to type it.
 *
 * Returns `null` when the file does not exist yet - the caller decides whether that is fatal.
 *
 * Two `bun:sqlite` behaviours differ from better-sqlite3 and both are load-bearing here:
 * `get()` yields `null` rather than `undefined` when no row matches, and `close()` is LAZY unless
 * given `true`, which on Windows leaves the file undeletable.
 */
export interface TestDatabase {
  prepare: (sql: string) => {
    get: (...params: unknown[]) => unknown;
    all: (...params: unknown[]) => unknown[];
    run: (...params: unknown[]) => { changes: number };
  };
  close: (throwOnError?: boolean) => void;
}

export async function openTestDatabase(
  options: { readonly?: boolean } = {}
): Promise<TestDatabase | null> {
  const fs = await import('fs');

  // Only the run's own database, named by scripts/test-with-server.mjs. Deliberately NOT
  // `DATABASE_PATH`: a bare `vitest` run loads the developer's `.env`, whose `DATABASE_PATH` is
  // their dev database, and a caller may WRITE through this handle.
  const DB_PATH = process.env.MIGALLERY_TEST_DATABASE;
  if (!DB_PATH) {
    throw new Error(
      'MIGALLERY_TEST_DATABASE is not set: server-backed tests run through `bun run test`, ' +
        'which creates a disposable database for them.'
    );
  }

  if (!fs.existsSync(DB_PATH)) {
    console.warn('WARN  Database not found at ' + DB_PATH);
    return null;
  }

  type DatabaseConstructor = new (path: string, options?: { readonly?: boolean }) => TestDatabase;

  const { Database } = (await import('bun:sqlite')) as unknown as {
    Database: DatabaseConstructor;
  };

  return new Database(DB_PATH, options);
}

/**
 * Log in as the suite's admin (written by `scripts/test-with-server.mjs` before any test runs) and
 * return its session cookie. Throws with the server's answer on failure: the suite hides console
 * output, so a reason that is only logged is never seen.
 */
export async function loginAsTestAdmin(): Promise<string> {
  const { API_BASE_URL } = TEST_CONFIG;

  const response = await fetch(`${API_BASE_URL}/dev/login-as?u=${TEST_CONFIG.TEST_ADMIN_ID}`, {
    redirect: 'manual',
  });
  const match = (response.headers.get('set-cookie') ?? '').match(/migallery_session=([^;]+)/);
  if (response.status === 303 && match) {
    return `migallery_session=${match[1]}`;
  }
  throw new Error(
    `login as the test admin failed: status ${response.status}, body=${(await response.text()).slice(0, 200)}`
  );
}

/**
 * Create an API key API
 */
async function createApiKey(
  sessionCookie: string,
  scopes: string[],
  label: string
): Promise<{ id: string; rawKey: string } | null> {
  const { API_BASE_URL } = TEST_CONFIG;

  try {
    const response = await fetch(`${API_BASE_URL}/api/admin/api-keys`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: sessionCookie,
      },
      body: JSON.stringify({ label, scopes }),
    });

    if (response.status === 200 || response.status === 201) {
      const data = (await response.json()) as { rawKey?: string; id?: string };
      if (data.rawKey && data.id) {
        console.debug(`✅ API key created (${label}): ${data.rawKey.substring(0, 20)}...`);
        return { id: data.id, rawKey: data.rawKey };
      }
    }

    console.error(`❌ Failed to create API key (status: ${response.status})`);
    return null;
  } catch (error) {
    console.error(`❌ Error creating API key: ${(error as Error).message}`);
    return null;
  }
}

/**
 * Create a test user and make them admin
 */
async function createTestUser(
  adminApiKey: string
): Promise<{ id_user: string; name: string } | null> {
  const { API_BASE_URL } = TEST_CONFIG;
  const timestamp = Date.now();
  const testUser = {
    id_user: `test.user.${timestamp}`,
    name: `Test User ${timestamp}`,
    first_name: 'Test',
    last_name: 'User',
    role: 'user' as const,
    promo: 2025,
  };

  try {
    // Create the user
    const createResponse = await fetch(`${API_BASE_URL}/api/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': adminApiKey,
      },
      body: JSON.stringify(testUser),
    });

    if (!createResponse.ok) {
      console.error(`❌ Failed to create user (status: ${createResponse.status})`);
      return null;
    }

    // Promote the user to admin
    const updateResponse = await fetch(`${API_BASE_URL}/api/users/${testUser.id_user}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': adminApiKey,
      },
      body: JSON.stringify({ ...testUser, role: 'admin' }),
    });

    if (!updateResponse.ok) {
      console.warn(`⚠️  Unable to promote user to admin (status: ${updateResponse.status})`);
    }

    console.debug(`✅ Test user created and promoted to admin: ${testUser.id_user}`);
    return { id_user: testUser.id_user, name: testUser.name };
  } catch (error) {
    console.error(`❌ Error creating user: ${(error as Error).message}`);
    return null;
  }
}

/**
 * Complete authentication setup for tests
 */
export async function setupTestAuth(): Promise<TestContext> {
  const { API_BASE_URL } = TEST_CONFIG;
  console.debug('\n🚀 Authentication setup for tests');
  console.debug(`📍 Base URL: ${API_BASE_URL}\n`);

  const context = createTestContext();

  // 1. Log in as the suite's admin
  const sessionCookie = await loginAsTestAdmin();
  if (!sessionCookie) {
    throw new Error('Login failed');
  }
  context.sessionCookie = sessionCookie;

  // 2. Create the API keys (admin, write, read)
  const adminKey = await createApiKey(sessionCookie, ['admin'], '[TEST] Admin Key');
  if (!adminKey) {
    throw new Error('Unable to create admin key');
  }
  context.adminApiKey = adminKey.rawKey;
  context.createdResources.apiKeys.push(adminKey.id);

  // Write key must include read to have access to read endpoints
  const writeKey = await createApiKey(sessionCookie, ['read', 'write'], '[TEST] Write Key');
  if (writeKey) {
    context.writeApiKey = writeKey.rawKey;
    context.createdResources.apiKeys.push(writeKey.id);
  }

  const readKey = await createApiKey(sessionCookie, ['read'], '[TEST] Read Key');
  if (readKey) {
    context.readApiKey = readKey.rawKey;
    context.createdResources.apiKeys.push(readKey.id);
  }

  // 4. Create a test user and make them admin
  const testUser = await createTestUser(context.adminApiKey);
  if (testUser) {
    context.testUserId = testUser.id_user;
    context.createdResources.users.push(testUser.id_user);
  }

  // Update the global context
  Object.assign(globalTestContext, context);

  console.debug('✅ Authentication setup complete\n');
  return context;
}

/**
 * Full cleanup after tests
 */
export async function teardownTestAuth(context: TestContext): Promise<void> {
  const { API_BASE_URL } = TEST_CONFIG;
  console.debug('\n🧹 Cleanup after tests');

  // Delete the test user
  if (context.testUserId) {
    await deleteOrThrow(`${API_BASE_URL}/api/users/${context.testUserId}`, {
      'x-api-key': context.adminApiKey,
    });
    console.debug(`✅ Test user deleted: ${context.testUserId}`);
  }

  // Delete the API keys
  for (const keyId of context.createdResources.apiKeys) {
    await deleteOrThrow(`${API_BASE_URL}/api/admin/api-keys/${keyId}`, {
      Cookie: context.sessionCookie,
    });
    console.debug('✅ API key deleted');
  }

  // Clean up other resources
  for (const userId of context.createdResources.users) {
    if (userId !== context.testUserId) {
      await cleanupResource(`${API_BASE_URL}/api/users`, context.adminApiKey, userId);
    }
  }

  for (const albumId of context.createdResources.albums) {
    await cleanupResource(`${API_BASE_URL}/api/albums`, context.adminApiKey, albumId);
  }

  console.debug('✅ Cleanup complete\n');
}

/**
 * Types for permission tests
 */
export interface PermissionTestConfig {
  endpoint: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  body?: Record<string, unknown> | string;
  requiredScope: 'public' | 'read' | 'write' | 'admin';
  description?: string;
}

export interface PermissionTestResult {
  noAuth: { status: number; passed: boolean };
  read: { status: number; passed: boolean };
  write: { status: number; passed: boolean };
  admin: { status: number; passed: boolean };
}

/**
 * Helper to test the permissions of an endpoint
 * Systematically checks:
 * - Without authentication -> should reject
 * - With read key -> accepts if requiredScope = 'read', rejects if 'write' or 'admin'
 * - With write key -> accepts if requiredScope <= 'write', rejects if 'admin'
 * - With admin key -> always accepts
 */
export async function testPermissions(config: PermissionTestConfig): Promise<PermissionTestResult> {
  const { API_BASE_URL } = TEST_CONFIG;
  const { endpoint, method = 'GET', body, requiredScope } = config;
  const url = `${API_BASE_URL}${endpoint}`;

  const result: PermissionTestResult = {
    noAuth: { status: 0, passed: false },
    read: { status: 0, passed: false },
    write: { status: 0, passed: false },
    admin: { status: 0, passed: false },
  };

  // Test 1: Without authentication
  try {
    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    result.noAuth.status = response.status;
    // Public -> should accept (200-299), otherwise should reject (401/403)
    result.noAuth.passed =
      requiredScope === 'public'
        ? response.status >= 200 && response.status < 300
        : response.status === 401 || response.status === 403;
  } catch {
    result.noAuth.status = 0;
    result.noAuth.passed = false;
  }

  // Test 2: With READ key
  try {
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': globalTestContext.readApiKey || '',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    result.read.status = response.status;
    // Read should accept if requiredScope = 'public' or 'read'
    const shouldAccept = requiredScope === 'public' || requiredScope === 'read';
    result.read.passed = shouldAccept
      ? (response.status >= 200 && response.status < 300) ||
        response.status === 500 ||
        response.status === 503 // Tolerate 500, and 503 (Immich not configured), in CI
      : response.status === 401 || response.status === 403;
  } catch {
    result.read.status = 0;
    result.read.passed = false;
  }

  // Test 3: With WRITE key
  try {
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': globalTestContext.writeApiKey || '',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    result.write.status = response.status;
    // Write should accept if requiredScope <= 'write'
    const shouldAccept =
      requiredScope === 'public' || requiredScope === 'read' || requiredScope === 'write';
    result.write.passed = shouldAccept
      ? (response.status >= 200 && response.status < 300) ||
        response.status === 500 ||
        response.status === 503 // Tolerate 500, and 503 (Immich not configured), in CI
      : response.status === 401 || response.status === 403;
  } catch {
    result.write.status = 0;
    result.write.passed = false;
  }

  // Test 4: With ADMIN key
  try {
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': globalTestContext.adminApiKey || '',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    result.admin.status = response.status;
    // Admin should always accept (unless the endpoint doesn't exist = 404)
    result.admin.passed =
      (response.status >= 200 && response.status < 300) ||
      response.status === 500 ||
      response.status === 503; // Tolerate 500, and 503 (Immich not configured), in CI
  } catch {
    result.admin.status = 0;
    result.admin.passed = false;
  }

  return result;
}

/**
 * Helper to format permission test results
 */
export function formatPermissionResults(
  config: PermissionTestConfig,
  result: PermissionTestResult
): string {
  const { endpoint, method = 'GET', requiredScope } = config;
  const lines: string[] = [];

  lines.push(`\n📋 Permission test: ${method} ${endpoint}`);
  lines.push(`   Required scope: ${requiredScope}`);
  lines.push('');
  lines.push(`   No auth:   ${result.noAuth.status} ${result.noAuth.passed ? '✅' : '❌'}`);
  lines.push(`   Read key:  ${result.read.status} ${result.read.passed ? '✅' : '❌'}`);
  lines.push(`   Write key: ${result.write.status} ${result.write.passed ? '✅' : '❌'}`);
  lines.push(`   Admin key: ${result.admin.status} ${result.admin.passed ? '✅' : '❌'}`);

  return lines.join('\n');
}

/**
 * Helper to clean up a full test context (legacy, kept for compatibility)
 */
export async function cleanupTestContext(context: TestContext): Promise<void> {
  await teardownTestAuth(context);
}
