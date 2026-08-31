# Deployment

MiGallery runs as a single Docker container (SvelteKit + Node) on port `3000`,
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
| Runtime       | Docker container `migallery` (SvelteKit + Node), port 3000                            |
| Data          | `data/` mounted as a volume (`/home/mitv/MiGallery/data`): SQLite + caches            |
| Image         | `ghcr.io/emse-students/migallery:latest` (built by CD)                                |
| CD            | `.github/workflows/cd.yml`: run-ci -> build-image -> deploy (self-hosted runner)      |
| Backups       | `scripts/backup-offsite.sh` -> offsite rsync to Canari (root cron, 05:00)             |
| Photo backend | Immich, separate stack, reachable at `IMMICH_BASE_URL`                                |

## Configuration

The CD generates `.env` from GitHub repo secrets. Non-secret values (ORIGIN,
IMMICH_BASE_URL, MICONNECT_ISSUER, ports) have defaults in
`docker-compose.prod.yml`.

| Variable                                                   | Role                                                 |
| ---------------------------------------------------------- | ---------------------------------------------------- |
| `IMMICH_BASE_URL`                                          | Immich API base (e.g. `http://10.0.0.4:2283`)        |
| `IMMICH_API_KEY` (secret)                                  | Immich API access; injected server-side by the proxy |
| `MICONNECT_ISSUER`                                         | Authentik issuer (`.../application/o/migallery`)     |
| `MICONNECT_CLIENT_ID` / `MICONNECT_CLIENT_SECRET` (secret) | OIDC client                                          |
| `ORIGIN`                                                   | public origin (`https://gallery.mitv.fr`)            |
| `DATABASE_PATH`                                            | SQLite path (`./data/migallery.db`)                  |
| `BODY_SIZE_LIMIT`                                          | max upload body (e.g. `20G`)                         |
| `ENABLE_DEV_ROUTES`                                        | dev-only routes; must be `false` in production       |

## Dependency updates, and the merge that reaches production

Dependabot opens the pull requests; `.github/workflows/dependabot-auto-merge.yml` decides which of
them this repository has EVIDENCE about, and `.github/scripts/dependabot-auto-merge.sh` is the
decision itself, shared by both of that workflow's triggers.

**Three things make it converge rather than merely fire.**

- **An hourly sweep, not only a `workflow_run`.** A pull request whose checks completed days ago
  never receives another event, so an event-only automation can act on what it happened to catch
  and on nothing else. The sweep enumerates every open Dependabot pull request, so the right state
  is reached from any starting state. The clock decides how fast the queue drains, never whether the
  outcome is right.
- **A staleness gate.** A green check is evidence about the workflow that PRODUCED it, not about the
  one `main` carries today, and an absent check is indistinguishable from an inapplicable one. A
  head not built on current `main` is not merged on its old verdict; its branch is updated instead
  (at most three per pass, because each is a full CI run), and the next pass reads a verdict that
  means something.
- **A dispatch, because a merge made with `GITHUB_TOKEN` raises no `push` event.** GitHub's
  anti-recursion rule means `cd.yml` never saw any of these merges, so `main` drifted from
  production silently. `workflow_dispatch` is the documented exception, and the sweep issues exactly
  one for the whole pass.

Merging several in one sweep is safe because of the shape of `cd.yml`: `run-ci` calls `ci.yml` on
the merged tree and `build-image` needs it, so a combination that only breaks together reddens
`main` and stops before any image is built. `main` can go red; production cannot follow it.

**The ceiling is what this repository declares itself unable to see.** It is not a semver judgement:
a break that stops the tree compiling is caught by `bun run check`, and a break in a route is caught
by a suite that boots a REAL server. An entry is a dependency whose failure would be INVISIBLE to
that, and every entry names the test that retires it - a refusal nobody can lift is the queue this
mechanism exists to avoid. Two are open, `jspdf` and `form-data`; `sharp` was the largest and is
closed, by `tests/face-crop.test.ts` asserting the output bytes of a real crop.

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
bun run lint         # oxlint + oxvelte
bun run test         # integration suite; bun run test:unit for Vitest only
```

The Husky pre-commit hook runs `bun run lint && bun run check` - oxlint, oxvelte and
svelte-check; keep all three green rather than bypassing the hook.
