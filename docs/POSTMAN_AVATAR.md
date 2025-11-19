# Guide Postman - Endpoint Avatar

## 📸 Récupération d'avatar utilisateur

### Endpoint
```
GET /api/users/{id_user}/avatar
```

### Description
Récupère la photo de profil (thumbnail) d'un utilisateur depuis Immich via son `id_user`.

---

## 🔐 Authentification

Trois méthodes supportées (par ordre de préférence) :

### 1. Clé API (Recommandé pour Postman)
```http
GET http://localhost:5173/api/users/jolan.boudin/avatar
x-api-key: mg_votre_cle_api_ici
```

**Scope requis** : `read`

### 2. Cookie de session (Navigateur)
```http
GET http://localhost:5173/api/users/jolan.boudin/avatar
Cookie: current_user_id=s%3A...signature...
```

### 3. Auth Provider (OAuth/SAML)
Authentification via le provider configuré (automatique pour les utilisateurs connectés).

---

## 📋 Configuration Postman

### Étape 1 : Créer une requête
1. Nouvelle requête → GET
2. URL : `http://localhost:5173/api/users/jolan.boudin/avatar`
3. Headers → Ajouter :
   - Key: `x-api-key`
   - Value: `mg_votre_cle_api_ici`

### Étape 2 : Envoyer
- Cliquez sur **Send**
- Si succès → Image affichée dans l'onglet "Preview"
- Si erreur → Voir section Codes d'erreur

---

## ✅ Exemples avec cURL

### Avec clé API
```bash
curl -H "x-api-key: mg_votre_cle_api" \
  http://localhost:5173/api/users/jolan.boudin/avatar \
  --output avatar.jpg
```

### Avec cookie de session (après login web)
```bash
curl -H "Cookie: current_user_id=s%3Ajolan.boudin..." \
  http://localhost:5173/api/users/jolan.boudin/avatar \
  --output avatar.jpg
```

### Sauvegarder l'image
```bash
curl -H "x-api-key: mg_votre_cle_api" \
  http://localhost:5173/api/users/jolan.boudin/avatar \
  -o jolan_boudin_avatar.jpg
```

---

## 📊 Codes de réponse

| Code | Signification | Action |
|------|---------------|--------|
| **200** | ✅ Succès - Image retournée | Image disponible dans le body |
| **401** | ❌ Non authentifié | Vérifiez votre clé API ou cookie |
| **403** | ❌ Accès refusé | Scope insuffisant (requiert `read`) |
| **404** | ⚠️ Utilisateur sans photo | L'utilisateur n'a pas d'`id_photos` configuré |
| **500** | ❌ Erreur serveur | Immich down ou erreur interne |
| **502** | ❌ Bad Gateway | Immich API inaccessible |

---

## 🔍 Détails techniques

### Paramètres
- **id_user** (path) : Identifiant de l'utilisateur (ex: `jolan.boudin`)

### Headers de réponse
- `Content-Type: image/jpeg` ou `image/png`
- `Cache-Control: public, max-age=3600` (cache 1 heure)

### Processus interne
1. Vérifie l'authentification (session / auth provider / x-api-key)
2. Cherche l'utilisateur dans la BDD locale par `id_user`
3. Si `id_photos` existe → Appel à Immich `/api/people/{id_photos}/thumbnail`
4. Retourne l'image avec cache HTTP

### Cas particuliers
- **Utilisateur système** (promo_year = NULL) : Peut ne pas avoir de photo
- **Nouvel utilisateur** : `id_photos` sera NULL jusqu'à reconnaissance faciale
- **404 vs 401** : 
  - 401 = pas authentifié
  - 404 = authentifié mais utilisateur n'a pas de photo

---

## 🧪 Tests

### Test 1 : Utilisateur avec photo
```http
GET http://localhost:5173/api/users/jolan.boudin/avatar
x-api-key: mg_test_key
```
**Attendu** : 200 OK + Image JPEG/PNG

### Test 2 : Utilisateur sans photo
```http
GET http://localhost:5173/api/users/system.admin/avatar
x-api-key: mg_test_key
```
**Attendu** : 404 Not Found + `{"error":"User has no photo configured"}`

### Test 3 : Sans authentification
```http
GET http://localhost:5173/api/users/jolan.boudin/avatar
```
**Attendu** : 401 Unauthorized + `{"error":"Unauthorized"}`

### Test 4 : Clé API avec scope insuffisant
```http
GET http://localhost:5173/api/users/jolan.boudin/avatar
x-api-key: mg_write_only_key
```
**Attendu** : 403 Forbidden + `{"error":"Forbidden: insufficient scope"}`

---

## 💡 Conseils Postman

### Variables d'environnement
Créez ces variables pour faciliter les tests :

```json
{
  "BASE_URL": "http://localhost:5173",
  "API_KEY": "mg_votre_cle_api",
  "TEST_USER": "jolan.boudin"
}
```

Requête avec variables :
```http
GET {{BASE_URL}}/api/users/{{TEST_USER}}/avatar
x-api-key: {{API_KEY}}
```

### Collection Postman
Créez une collection "MiGallery - Avatar" avec :
- Request 1 : GET avatar (avec API key)
- Request 2 : GET avatar (sans auth - test 401)
- Request 3 : GET avatar utilisateur système (test 404)

### Tests automatiques (Postman)
Ajoutez dans l'onglet "Tests" :

```javascript
pm.test("Status code is 200 or 404", function () {
    pm.expect([200, 404]).to.include(pm.response.code);
});

pm.test("Response has image content-type (if 200)", function () {
    if (pm.response.code === 200) {
        pm.expect(pm.response.headers.get("Content-Type")).to.include("image/");
    }
});

pm.test("404 returns JSON error", function () {
    if (pm.response.code === 404) {
        const json = pm.response.json();
        pm.expect(json).to.have.property("error");
    }
});
```

---

## 🔗 Liens utiles

- Documentation complète : `http://localhost:5173/admin/api-docs`
- Création de clés API : `http://localhost:5173/admin/api-keys`
- Référence sécurité : `docs/API_SECURITY.md`
- Tests automatisés : `tests/api.test.ts`

---

## 📝 Changelog

### 2025-11-19
- ✅ Ajout support x-api-key avec scope `read`
- ✅ Vérification getUserFromLocals() pour session/auth
- ✅ Documentation Postman complète
- ✅ Correction query SQL (id_user au lieu de username)
