# MiGallery migration / cloning to a new server

MiGallery runs as a Docker container (image published on GHCR by the CD). Almost all
deployment is automated; this document covers manual bootstrap of
a new server and data restoration.

> Media is **not** backed up/migrated (it lives in Immich, on the
> RAID). We migrate the MiGallery database and, if desired, the Immich database.

## Deployment architecture

| Element | Detail                                                                         |
| ------- | ------------------------------------------------------------------------------ |
| Runtime | `migallery` Docker container (SvelteKit + Node), port 3000                     |
| Data    | `data/` mounted as volume (`/home/mitv/MiGallery/data`): SQLite + caches       |
| Image   | `ghcr.io/emse-students/migallery:latest` (built by CD)                         |
| CD      | `.github/workflows/ci-cd.yml`: validate -> build-image -> deploy (self-hosted) |
| Backups | `scripts/backup-offsite.sh` -> offsite rsync to canari (root cron 05h)         |

## 0. Prerequisites

- Docker Engine + `docker compose` plugin.
- A self-hosted GitHub Actions runner (label `self-hosted`) whose user
  is a member of the `docker` group.
- Immich already installed and reachable (MiGallery is an overlay on top of it).

## 1. Self-hosted runner

GitHub -> repo -> Settings -> Actions -> Runners -> New self-hosted runner, then
install as a service. The runner user must be able to run `docker`
(`sudo usermod -aG docker <user>` then restart the runner service).

## 2. GitHub Secrets

The CD generates `.env` from repo secrets (Settings -> Secrets -> Actions):

| Secret                                            | Role                                                            |
| ------------------------------------------------- | --------------------------------------------------------------- |
| `IMMICH_API_KEY`                                  | access to the Immich API                                        |
| `MICONNECT_CLIENT_ID` / `MICONNECT_CLIENT_SECRET` | OIDC Authentik                                                  |
| `AUTH_SECRET`                                     | Auth.js signatures (`node ./scripts/generate-auth-secret.cjs`)  |
| `COOKIE_SECRET`                                   | cookie encryption (`node ./scripts/generate_cookie_secret.cjs`) |

Non-secret values (ORIGIN, IMMICH_BASE_URL, MICONNECT_ISSUER, ports...)
have defaults in `docker-compose.prod.yml`, overridable if needed.

## 3. SSH access for offsite backup

The backup pushes to canari. On the new server (as root, which runs the cron):

```bash
ssh-keyscan -H 10.0.0.3 >> /root/.ssh/known_hosts
```

On canari, authorize the public key of root@<server> in
`~/.ssh/authorized_keys` of the `canari` user and create `~/migallery-offsite/`.

## 4. First deployment

Trigger the CD (push on `main` or Actions -> Run workflow). It builds the image,
pushes it to GHCR, generates `.env`, then `docker compose up -d` on the server.

## 5. Data restoration

### MiGallery (our database)

```bash
./scripts/restore-offsite.sh --yes     # latest backup from canari
```

### Immich (optional)

Immich produces its own dumps (`library/backups/immich-db-backup-*.sql.gz`),
copied offsite to `~/migallery-offsite/immich/` on canari. Restoration follows
the **official Immich procedure** (recreating the database with its vector
extensions):

```bash
# Retrieve the dump from canari, then (see Immich docs):
#   docker compose down
#   (recreate the db volume)
#   docker compose up -d database
#   gunzip < immich-db-backup-*.sql.gz | docker exec -i immich_postgres psql -U postgres
#   docker compose up -d
```

See https://immich.app/docs/administration/backup-and-restore for the exact version.

## 6. Recurring backups

Root cron on the server (after the Immich dump at 02h):

```cron
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
0 5 * * * /home/mitv/MiGallery/scripts/backup-offsite.sh >> /var/log/migallery-backup.log 2>&1
```

## Checklist

- [ ] Docker + compose, self-hosted runner (docker group)
- [ ] GitHub Secrets created
- [ ] SSH server -> canari for offsite
- [ ] CD green (image + deployment)
- [ ] MiGallery database restored
- [ ] (opt) Immich database restored
- [ ] Backup cron installed
- [ ] Reverse proxy / DNS / TLS to port 3000
