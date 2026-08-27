# MiGallery Scripts

This folder contains utility scripts for development, maintenance, and deployment of MiGallery.

## Maintenance & Production

| Script                    | Description                                                               | Usage                          |
| :------------------------ | :------------------------------------------------------------------------ | :----------------------------- |
| `init-db.cjs`             | Initializes the SQLite database (creates tables and admin).               | `bun run db:init`              |
| `backup-db.cjs`           | Manual database backup (daily automatic backup is handled by the server). | `bun run db:backup`            |
| `cleanup-chunked-temp.js` | Cleans up orphaned temporary upload files.                                | `bun run cleanup:chunked-temp` |

## Development & Testing

| Script                 | Description                                                         | Usage                             |
| :--------------------- | :------------------------------------------------------------------ | :-------------------------------- |
| `run-tests.mjs`        | Runs the full test suite (unit and integration).                    | `bun run test`                    |
| `mock-immich.js`       | Simulates a local Immich server to test uploads without a real one. | `node scripts/mock-immich.js`     |
| `test-with-server.mjs` | Runs tests by automatically starting a temporary server.            | `bun run test`                    |
| `create-api-key.cjs`   | Utility to generate an API key with specific scopes.                | `node scripts/create-api-key.cjs` |
| `inspect-db.cjs`       | Debug tool to quickly view table contents.                          | `bun run db:inspect`              |

## Deployment & CI

| Script                | Description                                                 | Usage             |
| :-------------------- | :---------------------------------------------------------- | :---------------- |
| `wait-for-server.mjs` | Waits for the server URL to respond (used in `deploy.yml`). | CI internal       |
| `bun run package`     | Prepares a `.tgz` package ready for deployment.             | `bun run package` |

## Migration (one-time use)

| Script                          | Description                                                                            | Usage                                                        |
| :------------------------------ | :------------------------------------------------------------------------------------- | :----------------------------------------------------------- |
| `reset-users-for-authentik.cjs` | Deletes all users (CAS → Authentik migration, already executed).                       | `bun run db:reset-users`                                     |
| `migrate-export-db.cjs`         | Imports albums/permissions/logs from an old exported DB (migration, already executed). | `node scripts/migrate-export-db.cjs <source.db> [target.db]` |
