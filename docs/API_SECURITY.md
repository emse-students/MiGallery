# Sécurité API - MiGallery

## 🔐 Authentification

MiGallery supporte **deux méthodes d'authentification** :

### 1. Session Cookie (Navigateur)

- Utilisé automatiquement quand vous êtes connecté via l'interface web
- Cookie `current_user_id` signé par le serveur
- Idéal pour les requêtes depuis le navigateur
- **Appliqué à toutes les routes** : l'application frontend utilise les sessions

### 2. Clé API (Programmation)

- Header: `x-api-key: VOTRE_CLE_API`
- Créée depuis l'interface admin : `/admin/api-keys`
- Idéale pour les scripts, services externes, Postman, etc.
- **Obligatoire pour les accès externes** : toutes les routes API nécessitent une clé API si aucune session n'est active

**Règle d'autorisation** : Chaque endpoint accepte soit une session utilisateur valide, soit un header `x-api-key` avec le scope approprié.

---

## 🎯 Scopes et Permissions

Chaque clé API peut avoir un ou plusieurs **scopes** :

| Scope    | Description             | Exemples d'endpoints                                             |
| -------- | ----------------------- | ---------------------------------------------------------------- |
| `read`   | Lecture seule           | GET /api/albums, GET /api/users/{id}/avatar                      |
| `write`  | Création/modification   | POST /api/albums, PATCH /api/albums/{id}, PUT /api/users/{id}    |
| `delete` | Suppression             | DELETE /api/albums/{id}, DELETE /api/users/{id}                  |
| `admin`  | Administration complète | GET /api/users, POST /api/admin/api-keys, DELETE /api/users/{id} |

**Note** : Les scopes sont cumulatifs. Une clé avec `["read", "write"]` peut lire ET écrire.

---

## 📋 Matrice de Sécurité par Endpoint

### Albums

- `GET /api/albums` → **read**
- `GET /api/albums/{id}` → **read**
- `GET /api/albums/{id}/info` → **read**
- `POST /api/albums` → **write**
- `PATCH /api/albums/{id}` → **write**
- `DELETE /api/albums/{id}` → **delete**

### Users

- `GET /api/users` → **admin** (liste complète)
- `GET /api/users/{id}` → **read** ou propriétaire
- `GET /api/users/{id}/avatar` → **read**
- `POST /api/users` → **admin**
- `PUT /api/users/{id}` → **write** ou propriétaire
- `DELETE /api/users/{id}` → **admin**

### Assets (Immich proxy)

- `GET /api/immich/assets` → **read**
- `GET /api/immich/assets/{id}/thumbnail` → **read**
- `GET /api/immich/assets/{id}/original` → **read**

### People & Photos-CV

- `GET /api/people/*` → **read**
- `PUT /api/people/album/assets` → **write**
- `DELETE /api/people/album/assets` → **delete**

### External Media (PortailEtu)

- `GET /api/external/media` → **read**
- `POST /api/external/media` → **write**
- `DELETE /api/external/media` → **write**
- `GET /api/external/media/{id}` → **read**
- `DELETE /api/external/media/{id}` → **write**

### Administration

- `GET /api/admin/api-keys` → **admin**
- `POST /api/admin/api-keys` → **admin**
- `DELETE /api/admin/api-keys/{id}` → **admin**

### Utilitaires

- `GET /api/health` → **aucune authentification requise**
- `POST /api/change-user` → **dev only** (désactivé en production)

---

## 🚀 Exemples Postman

### Créer une clé API

```http
POST http://localhost:5173/api/admin/api-keys
Content-Type: application/json
x-api-key: VOTRE_CLE_ADMIN

{
  "label": "Service de monitoring",
  "scopes": ["read"]
}
```

**Réponse** (la clé brute n'est retournée qu'une seule fois!) :

```json
{
	"success": true,
	"key": "mg_1a2b3c4d5e6f7g8h9i0j...",
	"id": 42
}
```

### Lister les albums (avec clé API)

```http
GET http://localhost:5173/api/albums
x-api-key: mg_1a2b3c4d5e6f7g8h9i0j...
```

### Récupérer un avatar

```http
GET http://localhost:5173/api/users/jolan.boudin/avatar
x-api-key: mg_1a2b3c4d5e6f7g8h9i0j...
```

**Notes** :

- Si l'utilisateur n'a pas d'`id_photos` configuré → **404**
- Requiert scope `read`
- Cache HTTP : 1 heure

### Créer un album

```http
POST http://localhost:5173/api/albums
Content-Type: application/json
x-api-key: VOTRE_CLE_WRITE

{
  "albumName": "Forum des Associations 2025",
  "date": "2025-11-04",
  "location": "Campus EMSE",
  "visibility": "authenticated",
  "visible": true
}
```

### Modifier un album (métadonnées locales)

```http
PATCH http://localhost:5173/api/albums/7da109a3-f490-4d35-b31e-8ec6f92dd41c
Content-Type: application/json
x-api-key: VOTRE_CLE_WRITE

{
  "name": "Forum",
  "date": "2025-11-04",
  "tags": ["Promo 2024", "Événement"],
  "allowedUsers": ["alice.bob", "john.doe"],
  "visibility": "private",
  "visible": true
}
```

**Important** : Le PATCH ne modifie **que la base locale**, pas Immich. Les albums Immich et locaux sont liés uniquement par leur ID.

### Uploader un média vers PortailEtu

```http
POST http://localhost:5173/api/external/media
x-api-key: VOTRE_CLE_WRITE
Content-Type: multipart/form-data

[Binary file data: photo.jpg]
```

**Note** : Les médias sont automatiquement ajoutés à l'album système "PortailEtu" dans Immich.

---

## ⚠️ Codes d'erreur

| Code    | Signification                                         |
| ------- | ----------------------------------------------------- |
| **400** | Requête malformée (paramètres manquants ou invalides) |
| **401** | Non authentifié (clé API invalide ou absente)         |
| **403** | Accès refusé (scope insuffisant)                      |
| **404** | Ressource non trouvée                                 |
| **413** | Fichier trop volumineux                               |
| **500** | Erreur serveur (Immich down, erreur DB, etc.)         |

---

## 🔒 Bonnes pratiques

1. **Ne jamais exposer** les clés API dans le code client (frontend)
2. **Révoquer immédiatement** toute clé compromise
3. **Utiliser des scopes minimaux** : donnez uniquement les permissions nécessaires
4. **Rotation des clés** : changez régulièrement les clés pour les services critiques
5. **Logs** : surveillez les tentatives d'accès non autorisées (401/403)

---

## 📝 Collection Postman

Pour importer une collection Postman complète :

1. Ouvrir Postman
2. Fichier → Import
3. Créer une nouvelle collection "MiGallery"
4. Ajouter une variable d'environnement `BASE_URL` = `http://localhost:5173`
5. Ajouter une variable `API_KEY` = votre clé API

Exemple de requête avec variables :

```
GET {{BASE_URL}}/api/albums
x-api-key: {{API_KEY}}
```

---

## 🆘 Support

- **Documentation complète** : `/admin/api-docs`
- **Tests automatisés** : `bun run test` (voir `tests/README.md`)
- **Logs serveur** : vérifiez la console pour les erreurs d'authentification

---

## 🔄 Changelog Sécurité

### 2025-11-21

- ✅ **Sécurisation complète de l'API** : Toutes les requêtes externes nécessitent maintenant une authentification
- ✅ **Endpoints GET sécurisés** : `/api/albums/*`, `/api/immich/*`, `/api/people/*` acceptent session OU `x-api-key` avec scope `read`
- ✅ **Usage interne préservé** : L'application frontend continue de fonctionner normalement avec les cookies de session
- ✅ **Intégrations externes** : Doivent fournir le header `x-api-key` pour tous les appels API
- ✅ **Scopes appliqués** : `read` (GET), `write` (POST/PUT), `delete` (DELETE), `admin` (administration)

### 2025-11-20

- ✅ **Routes PortailEtu sécurisées** : `/api/external/media/*` requiert maintenant `x-api-key` avec scopes appropriés
- ✅ **Suppression de `verifyRawKey()`** : toutes les routes utilisent `verifyRawKeyWithScope()` pour vérifier les permissions
- ✅ **Uniformisation** : header `x-api-key` utilisé partout (plus de `x-portal-api-key`)
- ✅ **Scope DELETE** : routes PortailEtu utilisent scope `write` pour la suppression (workflow d'édition)
- ✅ **Documentation complète** : `/admin/api-docs` mise à jour avec tous les scopes

### 2025-11-19

- ✅ Ajout de l'authentification par x-api-key sur `/api/users/{id}/avatar`
- ✅ Documentation des scopes requis pour chaque endpoint
- ✅ Correction du bug SQL (`user_id` → `id_user`) dans `/api/albums/{id}/info`
- ✅ Ajout du PATCH `/api/albums/{id}` pour modifier les métadonnées locales
- ✅ Clarification : albums Immich et BDD locale sont indépendants (liés par ID uniquement)
