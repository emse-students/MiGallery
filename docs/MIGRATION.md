# Migration / clonage de MiGallery sur un nouveau serveur

MiGallery tourne en conteneur Docker (image publiee sur GHCR par la CD). La quasi
totalite du deploiement est automatisee ; ce document couvre le bootstrap manuel
d un nouveau serveur et la restauration des donnees.

> Les medias ne sont **pas** sauvegardes/migres (ils vivent dans Immich, sur le
> RAID). On migre la base MiGallery et, si voulu, la base Immich.

## Architecture de deploiement

| Element | Detail |
| --- | --- |
| Runtime | conteneur Docker `migallery` (SvelteKit + Bun), port 3000 |
| Donnees | `data/` monte en volume (`/home/mitv/MiGallery/data`) : SQLite + caches |
| Image | `ghcr.io/emse-students/migallery:latest` (buildee par la CD) |
| CD | `.github/workflows/ci-cd.yml` : validate -> build-image -> deploy (self-hosted) |
| Backups | `scripts/backup-offsite.sh` -> offsite rsync vers canari (cron root 05h) |

## 0. Pre-requis

- Docker Engine + plugin `docker compose`.
- Un runner GitHub Actions self-hosted (label `self-hosted`) dont l utilisateur
  est membre du groupe `docker`.
- Immich deja installe et joignable (MiGallery en est une surcouche).

## 1. Runner self-hosted

GitHub -> repo -> Settings -> Actions -> Runners -> New self-hosted runner, puis
installer en service. L utilisateur du runner doit pouvoir lancer `docker`
(`sudo usermod -aG docker <user>` puis redemarrer le service runner).

## 2. Secrets GitHub

La CD genere `.env` a partir des secrets du repo (Settings -> Secrets -> Actions) :

| Secret | Role |
| --- | --- |
| `IMMICH_API_KEY` | acces a l API Immich |
| `MICONNECT_CLIENT_ID` / `MICONNECT_CLIENT_SECRET` | OIDC Authentik |
| `AUTH_SECRET` | signatures Auth.js (`node ./scripts/generate-auth-secret.cjs`) |
| `COOKIE_SECRET` | chiffrement cookies (`node ./scripts/generate_cookie_secret.cjs`) |

Les valeurs non-secretes (ORIGIN, IMMICH_BASE_URL, MICONNECT_ISSUER, ports...)
ont des defauts dans `docker-compose.prod.yml`, surchargeables si besoin.

## 3. Acces SSH pour la sauvegarde offsite

Le backup pousse vers canari. Sur le nouveau serveur (en root, qui lance le cron) :

```bash
ssh-keyscan -H 10.0.0.3 >> /root/.ssh/known_hosts
```

Sur canari, autoriser la cle publique de root@<serveur> dans
`~/.ssh/authorized_keys` du user `canari` et creer `~/migallery-offsite/`.

## 4. Premier deploiement

Declencher la CD (push sur `main` ou Actions -> Run workflow). Elle build l image,
la pousse sur GHCR, genere `.env`, puis `docker compose up -d` sur le serveur.

## 5. Restauration des donnees

### MiGallery (notre base)

```bash
./scripts/restore-offsite.sh --yes     # derniere sauvegarde depuis canari
```

### Immich (optionnel)

Immich produit ses propres dumps (`library/backups/immich-db-backup-*.sql.gz`),
copies offsite dans `~/migallery-offsite/immich/` sur canari. La restauration suit
la **procedure officielle Immich** (recreation de la base avec ses extensions
vector) :

```bash
# Recuperer le dump depuis canari, puis (cf docs Immich) :
#   docker compose down
#   (recreer le volume db)
#   docker compose up -d database
#   gunzip < immich-db-backup-*.sql.gz | docker exec -i immich_postgres psql -U postgres
#   docker compose up -d
```

Voir https://immich.app/docs/administration/backup-and-restore pour la version exacte.

## 6. Sauvegardes recurrentes

Cron root sur le serveur (apres le dump Immich de 02h) :

```cron
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
0 5 * * * /home/mitv/MiGallery/scripts/backup-offsite.sh >> /var/log/migallery-backup.log 2>&1
```

## Checklist

- [ ] Docker + compose, runner self-hosted (groupe docker)
- [ ] Secrets GitHub crees
- [ ] SSH serveur -> canari pour l offsite
- [ ] CD passee au vert (image + deploiement)
- [ ] Base MiGallery restauree
- [ ] (option) Base Immich restauree
- [ ] Cron de sauvegarde installe
- [ ] Reverse proxy / DNS / TLS vers le port 3000
