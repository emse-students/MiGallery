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

| Element       | Detail                                                                                                     |
| ------------- | ---------------------------------------------------------------------------------------------------------- |
| Runtime       | Docker container `migallery` (SvelteKit + Node), port 3000                                                 |
| Data          | `data/` mounted as a volume (`/home/mitv/MiGallery/data`): SQLite + caches                                 |
| Image         | `ghcr.io/emse-students/migallery:latest` (built by CD)                                                     |
| CD            | `release.yml`: preflight -> `deploy.yml` (build-image -> deploy, self-hosted). **A push deploys nothing.** |
| Backups       | `scripts/backup-offsite.sh` -> offsite rsync to Canari (root cron, 05:00)                                  |
| Photo backend | Immich, separate stack, reachable at `IMMICH_BASE_URL`                                                     |

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

Dependabot opens the pull requests (`.github/dependabot.yml`); **from there they are the same as
anybody's**. `arm-auto-merge.yml` arms GitHub's own auto-merge on every pull request in the
repository, and GitHub squash-merges each one the moment `CI passed` goes green.

**There is no sweep any more (deleted 2026-09-04).** `dependabot-auto-merge.yml` was ~300 lines on
an hourly cron: it enumerated the open Dependabot pull requests, decided for ITSELF whether each was
green, and merged them with its own `gh pr merge`. It existed because a `pull_request` run raised by
Dependabot **gets no secrets** - GitHub runs it as if it came from a fork - so no App token can be
minted in that context, and an arming made with `GITHUB_TOKEN` produces a merge that raises no
`push` event. `pull_request_target` runs in the base repository's context, WITH its secrets, for
every pull request, which is what makes one file enough. It is safe on that trigger for one specific
reason: **it never checks the pull request out.**

**What went with the sweep that DID NOT work.** Its staleness gate refused to merge a head whose
check suite described gates `main` no longer carried, and the only way to lift that refusal was to
rebuild the branch - which no identity a workflow can mint may do. `PUT /pulls/{n}/update-branch`
writes a merge commit authored by `github-actions[bot]`, which parks the re-triggered run in
`action_required` and makes Dependabot refuse the branch for good; and `@dependabot recreate` is
answered _"Sorry, only users with push access can use that command"_ - **including when the caller
is a GitHub App**, measured ten times out of ten on emse-students/canari. An App INSTALLATION is not
an account with push access. _A gate whose only remedy is unavailable is a stop, not a gate._

The question it was trying to answer is answered elsewhere and better: `ci.yml` runs on `push: main`
as well as on `pull_request`, so a merge that breaks the trunk turns `CI passed` red ON `main`, where
somebody looking at the repository sees it. That verdict is also what the release gate reads.

## Nothing deploys on a push - the release does

**Since 2026-09-04, and in every repository of the ecosystem** (user: _"Pour tous les repos, le push
sur main ne doit rien deployer, c'est la release qui le fait."_). A merge to `main` runs the CI and
stops there. The human gesture that ships is publishing a GitHub release:

```sh
gh release create v1.2.3 --generate-notes
```

`release.yml` then asks three questions, all of them in `.github/scripts/release-preflight.sh` so
they can be tested without a run - and they are, on both sides of every gate:

1. **Is the version a version?** A typo becomes a deployed image tag nobody can find again.
2. **Is the released commit on `main`?** Everything downstream reads the trunk.
3. **Did `CI passed` go green ON that commit?** Not "run the tests again" - `cd.yml`'s `run-ci` job
   did exactly that, and a second run is a second opinion about the same tree, the one that ships.
   **An absent check is refused too**: that is not a failure, it means nothing ever asked.

Only then does it call `deploy.yml` - which is `cd.yml`'s two jobs, now a **library with no trigger
of its own**. The image carries a `v<version>` tag alongside `latest`, so a running container is
traceable to a release rather than to a commit nobody remembers publishing. A second job packages
the tarball and attaches it to the release; it neither gates the deploy nor is gated by it.

**So a merged fix is not a shipped fix**, and that is the deliberate cost. Dependency updates merge
themselves and then WAIT; what they wait for is somebody deciding this is the tree that ships.

### The security pass can now block a merge

`code-analysis.yml` is a `workflow_call` library with no triggers of its own. CodeQL, the TruffleHog
secret scan, the oxlint/SonarCloud pass and the vulnerability audit ran on every pull request and
**could not block one**, because nothing required them - _a red tick nothing enforces is worse than
no tick, because it looks enforced._ `ci.yml` calls it as its `security` job and aggregates
everything into `CI passed`; `scheduled.yml` calls the same file nightly, which is the half a pull
request cannot see: a new advisory landing against code nobody touched.

**The lockfile stays at `lockfileVersion: 1`** - Dependabot cannot read v2, and the symptom of a v2
lockfile is an ABSENCE of pull requests, which nobody notices.

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
