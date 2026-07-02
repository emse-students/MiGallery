# Deployment

MiGallery runs as a single Docker container (SvelteKit + Bun) on port `3000`,
behind a reverse proxy terminating TLS for `gallery.mitv.fr`. The image is built
and published to GHCR by the CD. This page is the operational summary;
[MIGRATION.md](../MIGRATION.md) is the authoritative runbook for cloning
MiGallery onto a new server.

Media is **not** part of MiGallery's backup/migration: it lives in Immich on the
RAID. MiGallery migrates its own SQLite database (and, optionally, the Immich
database, via Immich's own procedure).

## Topology

| Element       | Detail                                                                                |
| ------------- | ------------------------------------------------------------------------------------- |
| Runtime       | Docker container `migallery` (SvelteKit + Bun), port 3000                             |
| Data          | `data/` mounted as a volume (`/home/mitv/MiGallery/data`): SQLite + caches            |
| Image         | `ghcr.io/emse-students/migallery:latest` (built by CD)                                |
| CD            | `.github/workflows/ci-cd.yml`: validate -> build-image -> deploy (self-hosted runner) |
| Backups       | `scripts/backup-offsite.sh` -> offsite rsync to Canari (root cron, 05:00)             |
| Photo backend | Immich, separate stack, reachable at `IMMICH_BASE_URL`                                |

## Configuration

The CD generates `.env` from GitHub repo secrets. Non-secret values (ORIGIN,
IMMICH_BASE_URL, MICONNECT_ISSUER, ports) have defaults in
`docker-compose.prod.yml`.

| Variable                                                   | Role                                                          |
| ---------------------------------------------------------- | ------------------------------------------------------------- |
| `IMMICH_BASE_URL`                                          | Immich API base (e.g. `http://10.0.0.4:2283`)                 |
| `IMMICH_API_KEY` (secret)                                  | Immich API access; injected server-side by the proxy          |
| `MICONNECT_ISSUER`                                         | Authentik issuer (`.../application/o/migallery`)              |
| `MICONNECT_CLIENT_ID` / `MICONNECT_CLIENT_SECRET` (secret) | OIDC client                                                   |
| `AUTH_SECRET` (secret)                                     | session/signature secret (`scripts/generate-auth-secret.cjs`) |
| `COOKIE_SECRET` (secret)                                   | signed-cookie key (`scripts/generate_cookie_secret.cjs`)      |
| `ORIGIN`                                                   | public origin (`https://gallery.mitv.fr`)                     |
| `DATABASE_PATH`                                            | SQLite path (`./data/migallery.db`)                           |
| `BODY_SIZE_LIMIT`                                          | max upload body (e.g. `20G`)                                  |
| `ENABLE_DEV_ROUTES`                                        | dev-only routes; must be `false` in production                |

## Backups

A root cron runs `scripts/backup-offsite.sh` at 05:00 (after Immich's 02:00
dump), rsyncing the MiGallery SQLite DB offsite to Canari
(`~/migallery-offsite/`). Restore with `scripts/restore-offsite.sh --yes`. The
in-app daily backup scheduler (`startBackupScheduler`, kicked off in
`hooks.server.ts`) produces local DB snapshots under `data/`.

Immich has its own dumps and restore procedure (see the Immich docs); MiGallery
does not manage Immich's data.

## Local development

```bash
bun run dev          # dev server with HMR
bun run build        # production build -> build/
bun run check        # svelte-kit sync + svelte-check
bun run lint         # ESLint
bun run test         # integration suite; bun run test:unit for Vitest only
```

The Husky pre-commit hook runs ESLint + Prettier + svelte-check; keep all three
green rather than bypassing the hook.
