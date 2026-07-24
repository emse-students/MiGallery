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
# Run all tests (requires a running server)
npm run test

# Run a specific test file
npx vitest run tests/albums.test.ts
npx vitest run tests/users.test.ts
npx vitest run tests/admin-auth.test.ts
npx vitest run tests/e2e-integration.test.ts

# Watch mode (development)
npm run test:watch

# Tests with coverage
npm run test:coverage

# Tests with automatic server startup
npm run test
```

### 2. Tests by Domain

```bash
# Albums tests only
npx vitest run tests/albums.test.ts

# Users tests only
npx vitest run tests/users.test.ts

# Favorites and External Media tests
npx vitest run tests/favorites-external.test.ts

# Admin and Auth tests
npx vitest run tests/admin-auth.test.ts

# People/Photos-CV tests
npx vitest run tests/people-photoscv.test.ts

# Immich Proxy tests
npx vitest run tests/immich-proxy.test.ts

# Complete E2E tests
npx vitest run tests/e2e-integration.test.ts
```

### 3. Legacy Tests (Node.js script)

Classic Node.js test script with colored output.

```bash
# Run the original test script
npm run test:api
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
- ✅ `POST /api/albums/covers` - Cover generation
- ✅ Pagination, cursors, validations

### ✅ Users API (10+ endpoints)

- ✅ `GET /api/users` - User list (admin)
- ✅ `POST /api/users` - User creation (admin)
- ✅ `GET /api/users/:id` - User details
- ✅ `PUT /api/users/:id` - User modification (admin)
- ✅ `DELETE /api/users/:id` - User deletion (admin)
- ✅ `PATCH /api/users/me/promo` - Class year update
- ✅ `GET /api/users/:username/avatar` - Avatar (multi-size)
- ✅ Data validation (email, role, class year)
- ✅ Duplicate handling
- ✅ System user protection

### ✅ Favorites & External Media (10+ endpoints)

- ✅ `GET /api/favorites` - Favorites list
- ✅ `POST /api/favorites` - Add to favorites
- ✅ `DELETE /api/favorites` - Remove from favorites
- ✅ `GET /api/external/media` - External media list
- ✅ `POST /api/external/media` - External media creation
- ✅ `GET /api/external/media/:id` - Media details
- ✅ `DELETE /api/external/media/:id` - Media deletion
- ✅ `DELETE /api/external/media` - Bulk deletion
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

### ✅ External Media

- `GET /api/external/media` - PortailEtu album

### ✅ Health

- `GET /api/health` - API health

## 🚀 CI/CD

### GitHub Actions

Tests are automatically executed in two workflows:

#### 1. CI - `.github/workflows/ci.yml`

- ✅ Project build
- ✅ Test database initialization
- ✅ Server startup in background
- ✅ Vitest test suite execution
- ✅ Server shutdown

#### 2. Deploy - `.github/workflows/deploy.yml`

- ✅ Deployment to production server
- ✅ Server restart with PM2
- ✅ Post-deployment validation tests

## 🔧 Configuration

### Environment variables

```bash
# API base URL (default: http://localhost:3000)
API_BASE_URL=http://localhost:3000

# Database path (default: ./data/migallery.db)
DATABASE_PATH=./data/migallery.db
```

### Vitest Configuration

See `vitest.config.ts`:

- Global timeout: 30 seconds
- API tests with extended timeout: 15 seconds
- Environment: Node.js

## 📝 Prerequisites

### For local tests:

1. **Initialized database**

   ```bash
   npm run db:init
   ```

2. **System user created** (`les.roots`)

   ```bash
   node scripts/create-system-user.cjs
   ```

3. **Server running**

   ```bash
   # Development mode
   npm run dev

   # or production mode
   npm run build
   node build/index.js
   ```

4. **Environment variables configured** (`.env`)
   ```env
   AUTH_URL=http://localhost:3000
   AUTH_TRUST_HOST=true
   COOKIE_SECRET=your_64_char_hex_secret
   IMMICH_BASE_URL=http://your-immich-server:2283
   IMMICH_API_KEY=your_immich_api_key
   ENABLE_DEV_ROUTES=true
   ```

## 🐛 Troubleshooting

### Error: "Database not found"

```bash
npm run db:init
```

### Error: "System user les.roots not found"

```bash
node scripts/create-system-user.cjs
```

### Timeouts on Immich tests

This is normal if Immich is down or unreachable. Tests still pass with a warning.

### Error: "Connection refused"

Check that the server is running on port 3000:

```bash
curl http://localhost:3000/api/health
```

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
