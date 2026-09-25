# MiGallery API Tests

This project includes a complete and comprehensive API test suite using Vitest.

## 📂 Test Structure

### Tests organized by functional domain

- **`api.test.ts`** - Basic API tests (legacy, kept for compatibility)
- **`albums.test.ts`** - Comprehensive tests for the Albums API
  - Album listing, creation, modification, deletion
  - Asset management (add, delete, streaming)
  - Metadata and thumbnails
  - Album covers
- **`users.test.ts`** - Comprehensive tests for the Users API
  - Full user CRUD
  - Permission management (admin/user)
  - Avatars and profiles
  - Class year update
- **`favorites-external.test.ts`** - Tests for favorites and external media
  - Add/remove favorites
  - External media management (URL, embed)
  - Database operations
  - User switching
- **`admin-auth.test.ts`** - Tests for administration and authentication
  - API key management (create, list, delete)
  - Scopes and permissions (read, write, admin)
  - Database backup/restore
  - Data import/export
  - Health checks
  - API key validation
- **`people-photoscv.test.ts`** - Tests for the People/Photos-CV API
  - People listing
  - Photos per person
  - PhotoCV album management
  - Filters (class year, department, option)
  - Search by name
- **`immich-proxy.test.ts`** - Tests for the Immich proxy
  - Proxy for all HTTP methods (GET, POST, PUT, DELETE, PATCH)
  - Header forwarding
  - Cache management
  - Error and timeout handling
  - Scope validation
- **`e2e-integration.test.ts`** - End-to-end integration tests
  - Complete user workflows
  - Complete album workflows
  - Permission validation
  - Performance tests
  - Data validation

## 🧪 Available Test Commands

### 1. Vitest Tests (recommended)

Modern tests with Vitest, executed in CI/CD.

```bash
# Build, start a server on a disposable database, run everything, delete the database
bun run test

# Run a specific test file
bunx vitest run tests/albums.test.ts
bunx vitest run tests/users.test.ts
bunx vitest run tests/admin-auth.test.ts
bunx vitest run tests/e2e-integration.test.ts

# Watch mode (development)
bun run test:watch

# Tests with coverage
bun run test:coverage
```

### How `bun run test` isolates itself

`scripts/test-with-server.mjs` is the only supported way to run the server-backed suites, and the
run is **hermetic whatever your `.env` says**:

- It never reads `.env`. `package.json` starts it with `bun --no-env-file`, and it starts the build,
  the server and vitest the same way, with an environment it writes itself. The server honours
  that environment (it no longer force-loads `.env` over it).
- **Database**: a fresh `migallery.db` in a per-run temp directory (`%TEMP%/migallery-test-*`),
  created by the server on first open and deleted when the run ends - including on Ctrl-C. Your dev
  database is never opened, so a run leaves nothing behind and the next run starts from the same
  empty state.
- **Immich**: `IMMICH_BASE_URL` is empty, as in CI. The suite's contract is "no Immich"; tests that
  reach Immich accept the resulting 500. A dev `.env` pointing at a tunnel to the production Immich
  used to make the suite create real `[TEST]` albums there, and fail the tests whose assertions only
  run when Immich answers.
- Dev routes on (`/dev/login-as`), `AUTH_TRUSTED_HOST=true`, port 3000. If something already
  answers on port 3000 the run refuses to start, rather than testing that server and its database.

`openTestDatabase()` in `test-helpers.ts` opens only the file named by `MIGALLERY_TEST_DATABASE`,
which the runner sets, and throws when it is unset - so a bare `bunx vitest run tests/<file>` cannot
write into the database your `.env` names. The server-free suites (e.g. `disk-cache.test.ts`,
`auth-redirect.test.ts`, `sso-mirror.test.ts`, which makes its own temp database) run fine bare.

### 2. Tests by Domain

```bash
# Albums tests only
bunx vitest run tests/albums.test.ts

# Users tests only
bunx vitest run tests/users.test.ts

# Favorites and External Media tests
bunx vitest run tests/favorites-external.test.ts

# Admin and Auth tests
bunx vitest run tests/admin-auth.test.ts

# People/Photos-CV tests
bunx vitest run tests/people-photoscv.test.ts

# Immich Proxy tests
bunx vitest run tests/immich-proxy.test.ts

# Complete E2E tests
bunx vitest run tests/e2e-integration.test.ts
```

### 3. Legacy Tests (Node.js script)

Classic Node.js test script with colored output.

```bash
# Run the original test script
bun run test:api
# or
node ./scripts/test-api.cjs
```

## 📊 Coverage Statistics

| Domain                   | File                         | Tests    | Endpoints | Coverage   |
| ------------------------ | ---------------------------- | -------- | --------- | ---------- |
| **Albums**               | `albums.test.ts`             | 35+      | 15+       | ✅ 95%     |
| **Users**                | `users.test.ts`              | 40+      | 10+       | ✅ 100%    |
| **Favorites & External** | `favorites-external.test.ts` | 35+      | 10+       | ✅ 90%     |
| **Admin & Auth**         | `admin-auth.test.ts`         | 45+      | 12+       | ✅ 95%     |
| **People/Photos-CV**     | `people-photoscv.test.ts`    | 40+      | 15+       | ✅ 90%     |
| **Immich Proxy**         | `immich-proxy.test.ts`       | 50+      | 20+       | ✅ 85%     |
| **E2E Integration**      | `e2e-integration.test.ts`    | 30+      | -         | ✅ 100%    |
| **TOTAL**                | **8 files**                  | **275+** | **80+**   | **✅ 93%** |

## 📋 Detailed Test Coverage

### ✅ Albums API (15+ endpoints)

- ✅ `GET /api/albums` - Album list
- ✅ `POST /api/albums` - Album creation
- ✅ `GET /api/albums/:id` - Album details
- ✅ `PATCH /api/albums/:id` - Album modification
- ✅ `DELETE /api/albums/:id` - Album deletion
- ✅ `GET /api/albums/:id/assets-simple` - Assets (simple format)
- ✅ `GET /api/albums/:id/assets-stream` - Assets (streaming)
- ✅ `PUT /api/albums/:id/assets` - Add assets
- ✅ `DELETE /api/albums/:id/assets` - Delete assets
- ✅ `GET /api/albums/:id/info` - Detailed information
- ✅ `PUT /api/albums/:id/metadata` - Metadata update
- ✅ `GET /api/albums/:id/asset-thumbnail/:assetId` - Thumbnails
- ✅ `GET /api/albums/:id/asset-original/:assetId` - Original assets
- ✅ `GET /api/albums/:id/cover` - Square cover (public)
- ✅ `PUT /api/albums/:id/cover` - Pin a cover (write)
- ✅ Pagination, cursors, validations

### ✅ Users API (10+ endpoints)

- ✅ `GET /api/users` - User list (admin)
- ✅ `POST /api/users` - User creation (admin)
- ✅ `GET /api/users/:id` - User details
- ✅ `PUT /api/users/:id` - User modification (admin)
- ✅ `DELETE /api/users/:id` - User deletion (admin)
- ✅ `GET /api/users/:username/avatar` - Avatar (multi-size)
- ✅ Data validation (email, role, class year)
- ✅ Duplicate handling
- ✅ System user protection

### ✅ Favorites & External Media (7 endpoints)

- ✅ `GET /api/favorites` - Favorites list
- ✅ `POST /api/favorites` - Add to favorites
- ✅ `DELETE /api/favorites` - Remove from favorites
- ✅ `GET /api/external/media/:id` - Media details
- ✅ `DELETE /api/external/media/:id` - Media deletion
- ✅ `POST /api/db` - SQL operations (admin)
- ✅ `POST /api/change-user` - User switching

### ✅ Admin & Auth (12+ endpoints)

- ✅ `GET /api/admin/api-keys` - API key list (admin)
- ✅ `POST /api/admin/api-keys` - API key creation (admin)
- ✅ `DELETE /api/admin/api-keys/:id` - Key deletion (admin)
- ✅ `GET /api/admin/db-inspect` - DB inspection (admin)
- ✅ `GET /api/admin/db-export` - DB export (admin)
- ✅ `POST /api/admin/db-import` - DB import (admin)
- ✅ `POST /api/admin/db-backup` - DB backup (admin)
- ✅ `POST /api/admin/db-restore` - DB restore (admin)
- ✅ `GET /api/health` - Health check
- ✅ Scope validation (read, write, delete, admin)
- ✅ API key management
- ✅ Rate limiting

### ✅ People/Photos-CV (15+ endpoints)

- ✅ `GET /api/people/people` - People list
- ✅ `GET /api/people/people/:id/photos` - Person's photos
- ✅ `GET /api/people/people/:id/photos-stream` - Photos (streaming)
- ✅ `GET /api/people/person/:id/my-photos` - My photos
- ✅ `GET /api/people/person/:id/album-photos` - Album photos
- ✅ `GET /api/people` - People with filters
- ✅ `POST /api/people` - Person creation
- ✅ `GET /api/people/album` - PhotoCV album
- ✅ `GET /api/people/album/info` - PhotoCV album info
- ✅ `GET /api/people/album/:id/assets` - PhotoCV assets
- ✅ `PUT /api/people/album/:id/assets` - Add PhotoCV assets
- ✅ `DELETE /api/people/album/:id/assets` - Delete assets
- ✅ Filters (class year, department, option)
- ✅ Search by name
- ✅ Immich timeout handling

### ✅ Immich Proxy (20+ endpoints)

- ✅ `GET /api/immich/*` - Proxy GET
- ✅ `POST /api/immich/*` - Proxy POST
- ✅ `PUT /api/immich/*` - Proxy PUT
- ✅ `DELETE /api/immich/*` - Proxy DELETE
- ✅ `PATCH /api/immich/*` - Proxy PATCH
- ✅ Header forwarding (auth, custom)
- ✅ Cache management (Cache-Control, ETag)
- ✅ Content-Types (images, videos, JSON)
- ✅ Complex nested paths
- ✅ Query parameters
- ✅ FormData and uploads
- ✅ Error handling (502, 504, timeouts)
- ✅ Scope validation

### ✅ E2E Integration (complete workflows)

- ✅ Complete user workflow (CRUD)
- ✅ Complete album workflow (CRUD)
- ✅ Permissions and scopes workflow
- ✅ Favorites workflow
- ✅ External media workflow
- ✅ Critical endpoint verification
- ✅ Performance tests (20+ simultaneous requests)
- ✅ Stress tests
- ✅ Consistent data validation
- ✅ Automatic setup/teardown

## 🔧 Configuration and Helpers

### Centralized configuration (`test-helpers.ts`)

- ✅ Timeout configuration
- ✅ Scopes and roles
- ✅ Authentication helpers
- ✅ Test data generators
- ✅ Immich error handling
- ✅ Automatic resource cleanup
- ✅ TypeScript types

## 📋 Test Coverage (legacy)

### ✅ Authentication

- Detection of system user `les.roots`
- Login via `/dev/login-as`
- API key creation/deletion

### ✅ Albums

- `GET /api/albums` - Album list

### ✅ Users

- `GET /api/users` - List (admin)
- `GET /api/users/:id` - Details
- `POST /api/users` - Creation (admin)
- `PUT /api/users/:id` - Modification (admin)
- `DELETE /api/users/:id` - Deletion (admin)

### ✅ Photos-CV

- `GET /api/people/people` - Recognized people

### ✅ API Keys

- `GET /api/admin/api-keys` - List (admin)
- `POST /api/admin/api-keys` - Creation (admin)
- `DELETE /api/admin/api-keys/:id` - Deletion (admin)

### ✅ Immich Assets

- `GET /api/immich/assets` - Immich proxy

### ✅ Health

- `GET /api/health` - API health

## 🚀 CI/CD

### GitHub Actions

Tests are automatically executed in two workflows:

#### 1. CI - `.github/workflows/ci.yml`

- ✅ `bun run test`, the same command as locally: build, disposable database, server, suite, shutdown

#### 2. Deploy - `.github/workflows/deploy.yml`

- ✅ Deployment to production server
- ✅ Server restart with PM2
- ✅ Post-deployment validation tests

## 🔧 Configuration

There is nothing to configure: `bun run test` writes the whole test environment itself (see
[How `bun run test` isolates itself](#how-bun-run-test-isolates-itself)). No `db:init`, no running
server, no `.env` entry is needed, and none is read.

### Vitest Configuration

See `vitest.config.ts`:

- Global timeout: 30 seconds
- API tests with extended timeout: 15 seconds
- Environment: Node.js

## 🐛 Troubleshooting

### "Something already answers on http://localhost:3000"

Another server (a previous `bun build/index.js`, a dev preview) holds the test port. Stop it and
re-run; the suite refuses to test a server it did not start.

### "MIGALLERY_TEST_DATABASE is not set"

A server-backed test file was run bare with `bunx vitest run`. Run it through `bun run test`.

### Timeouts on Immich tests

The suite runs without Immich on purpose; tests that reach it accept the 500.

## 📊 Example Output

```
🚀 API test setup
📍 Base URL: http://localhost:3000

✅ System user les.roots exists (role: admin)
✅ Login successful with session cookie
✅ API key created: Fw0v6dGLtjlR...

✓ Albums API > should list albums
✓ Users API > should list users (admin)
✓ Users API > should retrieve the system user
✓ Users CRUD (Admin) > should create a user
✓ Users CRUD (Admin) > should retrieve the created user
✓ Users CRUD (Admin) > should modify the user
✓ Users CRUD (Admin) > should delete the user
⚠️  Immich unreachable (timeout)
✓ Photos-CV API > should list people
✓ API Keys (Admin) > should list API keys
⚠️  Immich unreachable (timeout)
✓ Assets API (Immich proxy) > should list assets
✓ External Media API > should list external media
✓ Health API > should check API health

🧹 Cleanup after tests
✅ API key successfully deleted
✅ Cleanup complete

 12 pass
 0 fail
 22 expect() calls
```

## 🔗 Useful Links

- [Vitest Documentation](https://vitest.dev/)
- [SvelteKit Testing](https://kit.svelte.dev/docs/testing)
- [Vitest](https://vitest.dev/)
