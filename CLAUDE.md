# MiGallery — Guide pour Claude Code

## Ce qu'est ce projet

Application web de galerie photo pour MiTV (EMSE). Elle encapsule **Immich** (backend photo self-hosted) en ajoutant : contrôle d'accès par rôle, gestion d'albums, SSO via Authentik (MiConnect), et une UI Svelte.

Le serveur SvelteKit agit principalement comme **proxy authentifié** vers l'API Immich.

---

## Stack technique

| Couche          | Technologie                                              |
| --------------- | -------------------------------------------------------- |
| Frontend        | Svelte 5, SvelteKit 2, TypeScript, Tailwind CSS 4        |
| Backend         | SvelteKit SSR (Node.js/Bun), adapter-node                |
| Base de données | SQLite via `better-sqlite3` (synchrone)                  |
| Auth            | Auth.js + Authentik OIDC (SSO MiConnect)                 |
| Photo backend   | Immich (API REST, proxiée via `/api/immich/*`)           |
| Build           | Vite, Bun de préférence                                  |
| Qualité         | ESLint, Prettier, Husky (pre-commit : lint + type-check) |

---

## Commandes essentielles

```bash
bun run dev          # Serveur de dev avec HMR
bun run build        # Build de production → build/
bun run check        # Type-check (svelte-check + tsc)
bun run lint         # ESLint
bun run format       # Prettier
bun run db:init      # Initialiser le schéma SQLite
bun run db:backup    # Backup manuel de la DB
bun run test         # Suite d'intégration complète
bun run test:unit    # Vitest unitaire uniquement
```

> Le hook pre-commit Husky exécute ESLint + Prettier + svelte-check. Un commit échoue si l'un d'eux échoue. Corriger le problème plutôt que de contourner le hook.

---

## Architecture des répertoires

```
src/
  lib/
    components/       # Composants Svelte réutilisables (UploadZone, PhotosGrid, Modal…)
    db/               # Accès SQLite : schéma, requêtes (users, albums, permissions)
    auth/             # Configuration Auth.js
    immich/           # Client Immich : albums, assets, téléchargements
    server/           # Utilitaires serveur-only (permissions, logs, cache, download-tokens)
    types/            # Types TypeScript centralisés (api.ts, streamsaver.d.ts)
    photos-cv/        # Logique spécifique aux photos CV (trombinoscope)
  routes/
    api/
      immich/[...path]/ # Proxy principal vers Immich — handler universel
      albums/           # CRUD albums (lecture depuis la DB locale + Immich)
      download/         # Téléchargement d'archives : token prep + streaming
      people/           # Gestion des personnes (photos CV)
      users/            # Gestion des utilisateurs
      auth/             # Login/logout/callback OIDC
      admin/            # Routes admin (DB export, logs, clés API)
    albums/             # Pages liste et détail d'albums
    photos-cv/          # Page album photos CV
    trombinoscope/      # Annuaire/trombinoscope
    admin/              # Interface d'administration
  hooks.server.ts       # Auth middleware, validation session, CSRF
  hooks.client.ts       # Navigation guard (opérations en cours), SW registration

data/                   # Runtime (gitignore) : DB, backups, chunks d'upload en cours
static/
  streamsaver-sw.js     # Service worker minimal (install/activate, sans interception fetch)
  mitm.html             # StreamSaver MITM (présent mais non utilisé activement)
scripts/                # Scripts Node.js : init-db, backup, cleanup-chunks, tests…
```

---

## Flux de données clés

### Authentification

1. Login → redirect Authentik (OIDC)
2. Callback → `Auth.js` crée session JWT (cookie httpOnly `__Secure-authjs.session-token`)
3. `hooks.server.ts` valide la session à chaque requête
4. `requireScope(event, 'read'|'write')` protège les endpoints API

Rôles : `admin` · `mitviste` (admin-like) · `user` (défaut)

### Proxy Immich

Toutes les routes `/api/immich/*` sont traitées par `src/routes/api/immich/[...path]/+server.ts`. Ce handler :

- Vérifie le scope (read/write)
- Gère les uploads en chunks (streaming disque, zéro RAM)
- Gère les albums publics (unlisted)
- Formate et retransmet les réponses binaires (images, vidéos, archives)

### Téléchargement d'archives (albums)

**Ne pas utiliser StreamSaver ni le service worker pour les téléchargements.**
Flux : `POST /api/download` (crée un token UUID) → `GET /api/download/{token}` (serveur streame depuis Immich, browser télécharge nativement). Voir `src/lib/immich/download.ts` et `src/lib/server/download-tokens.ts`.

### Upload de fichiers

- < 10 MB : `POST /api/immich/assets` avec `FormData` simple
- ≥ 10 MB : chunks de 5 MB avec reprise, hash SHA256 par chunk, stockage disque dans `data/chunk-uploads/`
- Le serveur stream les chunks vers le disque sans buffer RAM (`fs.createWriteStream`)
- À complétion : stream vers Immich via `fs.createReadStream` dans un FormData

---

## Base de données locale (SQLite)

La DB locale stocke **uniquement** ce qu'Immich ne gère pas :

- `users` — rôles (admin/mitviste/user), emails
- `albums` — visibilité (private/authenticated/unlisted), date, lieu
- `album_formation_permissions` — accès par formation
- `album_promo_permissions` — accès par année de promo
- `album_user_permissions` — accès par utilisateur individuel
- `album_tag_permissions` — tags libres
- `logs` — journal des événements (upload, delete, etc.)

Les IDs dans la DB locale correspondent aux IDs Immich (UUID).

---

## Variables d'environnement requises

```bash
# Immich
IMMICH_BASE_URL=http://10.0.0.4:2283
IMMICH_API_KEY=<clé_api_immich>

# Authentik OIDC (MiConnect)
MICONNECT_ISSUER=https://auth.canari-emse.fr/application/o/migallery
MICONNECT_CLIENT_ID=<client_id>
MICONNECT_CLIENT_SECRET=<client_secret>

# Auth.js
AUTH_SECRET=<64_chars_hex>      # node ./scripts/generate-auth-secret.cjs
AUTH_TRUSTED_HOST=true

# Serveur
PORT=3000
ORIGIN=https://gallery.mitv.fr
DATABASE_PATH=./data/migallery.db
COOKIE_SECRET=<64_chars_hex>    # node ./scripts/generate_cookie_secret.cjs

# Upload (taille max body)
BODY_SIZE_LIMIT=20G

# Dev uniquement — jamais en prod
ENABLE_DEV_ROUTES=false
```

---

## Points d'attention

- **Svelte 5 runes** : ce projet utilise `$state`, `$derived`, `$effect`. Ne pas utiliser l'ancienne syntaxe `reactive` / `$:`.
- **SSR** : tout import de librairie browser-only (ex. StreamSaver) doit être lazy (`await import(...)`) ou conditionné par `typeof window !== 'undefined'`.
- **Pas de buffering mémoire** pour les gros fichiers : uploads streamés vers disque, téléchargements via token natif. Ne pas introduire de `Buffer.alloc` ou accumulation de chunks pour des fichiers > quelques MB.
- **DB synchrone** : `better-sqlite3` est synchrone par design. Les requêtes sont dans des handlers serveur, c'est intentionnel.
- **Concurrence uploads** : verrou par fichier via `fs.openSync(lockPath, 'wx')`. Ne pas supprimer cette logique.
- **Iconographie** : uniquement `lucide-svelte`. Ne pas utiliser d'alias (`ScanFace`, `CheckSquare`) — vérifier que le nom existe dans la version installée.
