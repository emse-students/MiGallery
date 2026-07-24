# MiGallery Scripts

This folder contains utility scripts for development, maintenance, and deployment of MiGallery.

## Maintenance & Production

| Script                       | Description                                                               | Usage                                     |
| :--------------------------- | :------------------------------------------------------------------------ | :---------------------------------------- |
| `init-db.cjs`                | Initializes the SQLite database (creates tables and admin).               | `npm run db:init`                         |
| `backup-db.cjs`              | Manual database backup (daily automatic backup is handled by the server). | `npm run db:backup`                       |
| `cleanup-chunked-temp.js`    | Cleans up orphaned temporary upload files.                                | `npm run cleanup:chunked-temp`            |
| `generate-auth-secret.cjs`   | Generates an `AUTH_SECRET` key for configuration.                         | `node scripts/generate-auth-secret.cjs`   |
| `generate_cookie_secret.cjs` | Generates a `COOKIE_SECRET` key for session.                              | `node scripts/generate_cookie_secret.cjs` |

## Development & Testing

| Script                 | Description                                                         | Usage                             |
| :--------------------- | :------------------------------------------------------------------ | :-------------------------------- |
| `run-tests.mjs`        | Runs the full test suite (unit and integration).                    | `npm run test`                    |
| `mock-immich.js`       | Simulates a local Immich server to test uploads without a real one. | `node scripts/mock-immich.js`     |
| `test-with-server.mjs` | Runs tests by automatically starting a temporary server.            | `npm test`                        |
| `create-api-key.cjs`   | Utility to generate an API key with specific scopes.                | `node scripts/create-api-key.cjs` |
| `inspect-db.cjs`       | Debug tool to quickly view table contents.                          | `npm run db:inspect`              |

## Deployment & CI

| Script                | Description                                                 | Usage             |
| :-------------------- | :---------------------------------------------------------- | :---------------- |
| `wait-for-server.mjs` | Waits for the server URL to respond (used in `deploy.yml`). | CI internal       |
| `npm run package`     | Prepares a `.tgz` package ready for deployment.             | `npm run package` |

## Migration (one-time use)

| Script                          | Description                                                                            | Usage                                                        |
| :------------------------------ | :------------------------------------------------------------------------------------- | :----------------------------------------------------------- |
| `reset-users-for-authentik.cjs` | Deletes all users (CAS → Authentik migration, already executed).                       | `npm run db:reset-users`                                     |
| `migrate-export-db.cjs`         | Imports albums/permissions/logs from an old exported DB (migration, already executed). | `node scripts/migrate-export-db.cjs <source.db> [target.db]` |
