# MiGallery migration / cloning to a new server

MiGallery runs as a Docker container (image published on GHCR by the CD). Almost all
deployment is automated; this document covers manual bootstrap of
a new server and data restoration.

> Media is **not** backed up/migrated (it lives in Immich, on the
> RAID). We migrate the MiGallery database and, if desired, the Immich database.

## Deployment architecture

| Element | Detail                                                                                                      |
| ------- | ----------------------------------------------------------------------------------------------------------- |
| Runtime | `migallery` Docker container (SvelteKit + Node), port 3000                                                  |
| Data    | `data/` mounted as volume (`/home/mitv/MiGallery/data`): SQLite + caches                                    |
| Image   | `ghcr.io/emse-students/migallery:latest` (built by CD)                                                      |
| CD      | `.github/workflows/release.yml`: preflight -> `deploy.yml` (build-image -> deploy). A push deploys nothing. |
| Backups | `scripts/backup-offsite.sh` -> offsite rsync to canari (root cron 05h)                                      |

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

| Secret                                            | Role                     |
| ------------------------------------------------- | ------------------------ |
| `IMMICH_API_KEY`                                  | access to the Immich API |
| `MICONNECT_CLIENT_ID` / `MICONNECT_CLIENT_SECRET` | OIDC Authentik           |

Non-secret values (ORIGIN, IMMICH_BASE_URL, MICONNECT_ISSUER, ports...)
have defaults in `docker-compose.prod.yml`, overridable if needed.

## 3. SSH access for offsite backup

The backup pushes to the offsite server named in `/etc/migallery/offsite.env` (the host and its
account are in the private operations notes, never here). On the new server, as root (which runs
the cron):

```bash
install -d -m 755 /etc/migallery   # 755: the deploy runner checks the file exists
printf 'OFFSITE_HOST=%s
OFFSITE_PATH=%s
' '<user>@<offsite-host>' 'migallery-offsite' > /etc/migallery/offsite.env
chmod 600 /etc/migallery/offsite.env
ssh-keyscan -H <offsite-host> >> /root/.ssh/known_hosts
```

On the offsite server, authorize the public key of root@<server> in that account's
`~/.ssh/authorized_keys` and create the `OFFSITE_PATH` directory. Without the env file, the
backup and the restore stop and name it.

## 4. First deployment

Trigger the CD (push on `main` or Actions -> Run workflow). It builds the image,
pushes it to GHCR, generates `.env`, then `docker compose up -d` on the server.

## 5. Data restoration

### MiGallery (our database)

```bash
./scripts/restore-offsite.sh --yes     # latest backup from the offsite server
```

### Immich (optional)

Immich produces its own dumps (`library/backups/immich-db-backup-*.sql.gz`),
copied offsite to `<OFFSITE_PATH>/immich/` on the offsite server. Restoration follows
the **official Immich procedure** (recreating the database with its vector
extensions):

```bash
# Retrieve the dump from the offsite server, then (see Immich docs):
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
