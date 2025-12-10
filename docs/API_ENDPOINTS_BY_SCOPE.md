# 📋 Liste Complète des Endpoints par Scope

## 🔍 Vue d'ensemble

**Total endpoints** : 64
**Scopes disponibles** : `public`, `read`, `write`, `admin`, `session-only`

---

## 🌍 PUBLIC (aucune authentification)

| Méthode | Endpoint      | Description                       |
| ------- | ------------- | --------------------------------- |
| `GET`   | `/api/health` | Vérifier que le serveur est actif |

**Exemple de réponse** :

```json
{ "status": "ok", "timestamp": "2025-12-09T20:54:41.042Z", "database": "connected" }
```

---

## 👤 SESSION-ONLY (cookie session uniquement, x-api-key NON supporté)

| Méthode  | Endpoint                | Description                        |
| -------- | ----------------------- | ---------------------------------- |
| `GET`    | `/api/favorites`        | Récupérer favoris de l'utilisateur |
| `POST`   | `/api/favorites`        | Ajouter aux favoris                |
| `DELETE` | `/api/favorites`        | Retirer des favoris                |
| `PATCH`  | `/api/users/me/promo`   | Modifier sa propre promotion       |
| `POST`   | `/api/change-user`      | Changer d'utilisateur (dev only)   |
| `POST`   | `/api/admin/db-backup`  | Créer backup DB                    |
| `GET`    | `/api/admin/db-export`  | Exporter DB                        |
| `POST`   | `/api/admin/db-import`  | Importer DB (🔴 DANGEREUX)         |
| `GET`    | `/api/admin/db-inspect` | Inspecter structure DB             |
| `POST`   | `/api/admin/db-restore` | Restaurer DB (🔴 DANGEREUX)        |
| `GET`    | `/dev/login-as`         | Se connecter comme un user (dev)   |

**Note sécurité** : Les endpoints DB admin sont session-only pour éviter automatisation non supervisée d'opérations critiques.

---

## 📖 READ (session OU x-api-key avec scope `read`/`write`/`admin`)

### Albums (9 endpoints)

| Méthode | Endpoint                                                  |
| ------- | --------------------------------------------------------- |
| `GET`   | `/api/albums`                                             |
| `GET`   | `/api/albums/{id}`                                        |
| `GET`   | `/api/albums/{id}/info`                                   |
| `GET`   | `/api/albums/{id}/assets-stream`                          |
| `GET`   | `/api/albums/{id}/asset-original/{assetId}` \*            |
| `GET`   | `/api/albums/{id}/asset-thumbnail/{assetId}` \*           |
| `GET`   | `/api/albums/{id}/asset-thumbnail/{assetId}/thumbnail` \* |

**\* Note** : Accès public si album `visibility='unlisted'`

### Assets via Immich (3 endpoints)

| Méthode | Endpoint                            |
| ------- | ----------------------------------- |
| `GET`   | `/api/immich/assets`                |
| `GET`   | `/api/immich/assets/{id}/thumbnail` |
| `GET`   | `/api/immich/assets/{id}/original`  |

### People & PhotoCV (10 endpoints)

| Méthode | Endpoint                                      |
| ------- | --------------------------------------------- |
| `GET`   | `/api/people/people`                          |
| `GET`   | `/api/people/people/{personId}/photos`        |
| `GET`   | `/api/people/people/{personId}/photos-stream` |
| `GET`   | `/api/people/person/{id}/my-photos`           |
| `GET`   | `/api/people/person/{id}/album-photos`        |
| `GET`   | `/api/people/album/{albumId}/assets`          |
| `GET`   | `/api/people/album`                           |
| `GET`   | `/api/people/album/info`                      |
| `GET`   | `/api/people` (legacy, DEPRECATED)            |

### Users (2 endpoints)

| Méthode | Endpoint                       | Note                                       |
| ------- | ------------------------------ | ------------------------------------------ |
| `GET`   | `/api/users/{id}`              | Admin : tous users. User : self uniquement |
| `GET`   | `/api/users/{username}/avatar` | Proxie Immich                              |

### External PortailEtu (2 endpoints)

| Méthode | Endpoint                   |
| ------- | -------------------------- |
| `GET`   | `/api/external/media`      |
| `GET`   | `/api/external/media/{id}` |

**Total READ** : 26 endpoints

---

## ✏️ WRITE (session OU x-api-key avec scope `write`/`admin`)

### Albums (5 endpoints)

| Méthode  | Endpoint                  | Description          |
| -------- | ------------------------- | -------------------- |
| `POST`   | `/api/albums`             | Créer album          |
| `PATCH`  | `/api/albums/{id}`        | Modifier métadonnées |
| `DELETE` | `/api/albums/{id}`        | Supprimer album      |
| `PUT`    | `/api/albums/{id}/assets` | Ajouter assets       |
| `DELETE` | `/api/albums/{id}/assets` | Retirer assets       |

### People & PhotoCV (6 endpoints)

| Méthode  | Endpoint                             |
| -------- | ------------------------------------ |
| `PUT`    | `/api/people/album/assets`           |
| `DELETE` | `/api/people/album/assets`           |
| `PUT`    | `/api/people/album/{albumId}/assets` |
| `DELETE` | `/api/people/album/{albumId}/assets` |
| `POST`   | `/api/people` (legacy, DEPRECATED)   |

### Users (1 endpoint)

| Méthode | Endpoint          | Note                                             |
| ------- | ----------------- | ------------------------------------------------ |
| `PUT`   | `/api/users/{id}` | Admin : tous users. User : self (champs limités) |

### External PortailEtu (3 endpoints)

| Méthode  | Endpoint                   | Description             |
| -------- | -------------------------- | ----------------------- |
| `POST`   | `/api/external/media`      | Upload média            |
| `DELETE` | `/api/external/media`      | Supprimer médias (bulk) |
| `DELETE` | `/api/external/media/{id}` | Supprimer 1 média       |

**Total WRITE** : 15 endpoints

---

## 🔐 ADMIN (session admin OU x-api-key avec scope `admin`)

### Users (3 endpoints)

| Méthode  | Endpoint          | Harmonisé |
| -------- | ----------------- | --------- |
| `GET`    | `/api/users`      | ✅        |
| `POST`   | `/api/users`      | ✅        |
| `DELETE` | `/api/users/{id}` | ✅        |

### API Keys (3 endpoints)

| Méthode  | Endpoint                   | Harmonisé |
| -------- | -------------------------- | --------- |
| `GET`    | `/api/admin/api-keys`      | ✅        |
| `POST`   | `/api/admin/api-keys`      | ✅        |
| `DELETE` | `/api/admin/api-keys/{id}` | ✅        |

**Total ADMIN** : 6 endpoints
**Statut harmonisation** : 6/6 acceptent x-api-key ✅

---

## ❌ DÉSACTIVÉS (raisons de sécurité)

| Méthode | Endpoint  | Raison                                                                                                                                 |
| ------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `POST`  | `/api/db` | 🔴 **5 vulnérabilités critiques** : SQL injection, bypass validation, accès tables sensibles, DDL non contrôlé, information disclosure |

**Alternative sécurisée** : Utiliser `/api/admin/db-*` (session-only)

---

## 📊 Statistiques

| Scope        | Nombre d'endpoints | % du total |
| ------------ | ------------------ | ---------- |
| PUBLIC       | 1                  | 2%         |
| SESSION-ONLY | 11                 | 17%        |
| READ         | 26                 | 41%        |
| WRITE        | 15                 | 23%        |
| ADMIN        | 6                  | 9%         |
| DÉSACTIVÉ    | 1                  | 2%         |
| **TOTAL**    | **64**             | **100%**   |

### Méthodes HTTP

| Méthode | Nombre |
| ------- | ------ |
| GET     | 34     |
| POST    | 13     |
| DELETE  | 10     |
| PUT     | 5      |
| PATCH   | 2      |

---

## 🔑 Guide d'utilisation des scopes

### Hiérarchie des scopes

```
PUBLIC (aucune auth)
  └─ SESSION-ONLY (cookie uniquement)
  └─ READ (session OU x-api-key:read/write/admin)
      └─ WRITE (session OU x-api-key:write/admin)
          └─ ADMIN (session admin OU x-api-key:admin)
```

### Créer une clé API

```bash
# Scope READ (lecture seule)
node scripts/create-api-key.cjs read ma-cle-read

# Scope WRITE (lecture + écriture)
node scripts/create-api-key.cjs write ma-cle-write

# Scope ADMIN (tous les pouvoirs)
node scripts/create-api-key.cjs admin ma-cle-admin
```

### Utilisation dans les requêtes

```bash
# Avec x-api-key
curl -H "x-api-key: YOUR_KEY" http://localhost:5173/api/albums

# Avec session (cookie)
curl -H "Cookie: session=..." http://localhost:5173/api/favorites
```

---

## ⚠️ Notes de sécurité

1. **Session-only endpoints** : Favoris et DB admin nécessitent cookie session (pas x-api-key)
2. **Endpoints /dev/** : Désactivés en prod sauf si `ENABLE_DEV_ROUTES=true` dans `.env`
3. **Endpoints /api/external/** : CORS activé, nécessitent header `Origin`
4. **Albums unlisted** : Accès public aux assets sans auth
5. **Scope admin** : Permet toutes les opérations (read + write + admin)

---

**Généré le** : 9 décembre 2025
**Version** : 2.0
