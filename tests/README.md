# Tests API MiGallery

Ce projet inclut une suite complète de tests API utilisant Vitest.

## 🧪 Tests disponibles

### 1. Tests Vitest (recommandé)

Tests modernes avec Vitest, exécutés dans la CI/CD.

```bash
# Lancer tous les tests (nécessite un serveur qui tourne)
bun test

# Lancer uniquement les tests API
bun test tests/api.test.ts

# Mode watch (développement)
bun test:watch

# Tests avec démarrage automatique du serveur
bun test:api:full
```

### 2. Tests legacy (script Node.js)

Script de test Node.js classique avec output coloré.

```bash
# Lancer le script de test original
bun run test:api
# ou
node ./scripts/test-api.cjs
```

## 📋 Couverture des tests

Les tests Vitest couvrent les endpoints suivants :

### ✅ Authentification
- Détection de l'utilisateur système `les.roots`
- Connexion via `/dev/login-as`
- Création/suppression de clés API

### ✅ Albums
- `GET /api/albums` - Liste des albums

### ✅ Utilisateurs
- `GET /api/users` - Liste (admin)
- `GET /api/users/:id` - Détails
- `POST /api/users` - Création (admin)
- `PUT /api/users/:id` - Modification (admin)
- `DELETE /api/users/:id` - Suppression (admin)

### ✅ Photos-CV
- `GET /api/photos-cv/people` - Personnes reconnues

### ✅ Clés API
- `GET /api/admin/api-keys` - Liste (admin)
- `POST /api/admin/api-keys` - Création (admin)
- `DELETE /api/admin/api-keys/:id` - Suppression (admin)

### ✅ Assets Immich
- `GET /api/immich/assets` - Proxy Immich

### ✅ Médias externes
- `GET /api/external/media` - Album PortailEtu

### ✅ Health
- `GET /api/health` - Santé de l'API

## 🚀 CI/CD

### GitHub Actions

Les tests sont automatiquement exécutés dans deux workflows :

#### 1. CI (Bun) - `.github/workflows/ci-bun.yml`
- ✅ Build du projet
- ✅ Initialisation de la base de données de test
- ✅ Démarrage du serveur en background
- ✅ Exécution de la suite de tests Vitest
- ✅ Arrêt du serveur

#### 2. Deploy - `.github/workflows/deploy.yml`
- ✅ Déploiement sur le serveur de production
- ✅ Redémarrage du serveur avec PM2
- ✅ Exécution des tests de validation post-déploiement

## 🔧 Configuration

### Variables d'environnement

```bash
# URL de base de l'API (défaut: http://localhost:3000)
API_BASE_URL=http://localhost:3000

# Chemin de la base de données (défaut: ./data/migallery.db)
DATABASE_PATH=./data/migallery.db
```

### Configuration Vitest

Voir `vitest.config.ts` :
- Timeout global : 30 secondes
- Tests d'API avec timeout étendu : 15 secondes
- Environnement : Node.js

## 📝 Prérequis

### Pour les tests locaux :

1. **Base de données initialisée**
   ```bash
   bun run db:init
   ```

2. **Utilisateur système créé** (`les.roots`)
   ```bash
   node scripts/create-system-user.cjs
   ```

3. **Serveur en cours d'exécution**
   ```bash
   # Mode développement
   bun run dev
   
   # ou mode production
   bun run build
   bun run build/index.js
   ```

4. **Variables d'environnement configurées** (`.env`)
   ```env
   AUTH_URL=http://localhost:3000
   AUTH_TRUST_HOST=true
   COOKIE_SECRET=your_64_char_hex_secret
   IMMICH_BASE_URL=http://your-immich-server:2283
   IMMICH_API_KEY=your_immich_api_key
   ENABLE_DEV_ROUTES=true
   ```

## 🐛 Dépannage

### Erreur: "Base de données introuvable"
```bash
bun run db:init
```

### Erreur: "Utilisateur système les.roots introuvable"
```bash
node scripts/create-system-user.cjs
```

### Timeouts sur les tests Immich
C'est normal si Immich est down ou inaccessible. Les tests passent quand même avec un avertissement.

### Erreur: "Connection refused"
Vérifiez que le serveur tourne sur le port 3000 :
```bash
curl http://localhost:3000/api/health
```

## 📊 Exemple de sortie

```
🚀 Setup des tests API
📍 URL de base: http://localhost:3000

✅ Utilisateur système les.roots existe (rôle: admin)
✅ Connexion réussie avec cookie de session
✅ Clé API créée: Fw0v6dGLtjlR...

✓ Albums API > devrait lister les albums
✓ Users API > devrait lister les utilisateurs (admin)
✓ Users API > devrait récupérer l'utilisateur système
✓ Users CRUD (Admin) > devrait créer un utilisateur
✓ Users CRUD (Admin) > devrait récupérer l'utilisateur créé
✓ Users CRUD (Admin) > devrait modifier l'utilisateur
✓ Users CRUD (Admin) > devrait supprimer l'utilisateur
⚠️  Immich non accessible (timeout)
✓ Photos-CV API > devrait lister les personnes
✓ API Keys (Admin) > devrait lister les clés API
⚠️  Immich non accessible (timeout)
✓ Assets API (Immich proxy) > devrait lister les assets
✓ External Media API > devrait lister les médias externes
✓ Health API > devrait vérifier la santé de l'API

🧹 Nettoyage après les tests
✅ Clé API supprimée avec succès
✅ Nettoyage terminé

 12 pass
 0 fail
 22 expect() calls
```

## 🔗 Liens utiles

- [Vitest Documentation](https://vitest.dev/)
- [SvelteKit Testing](https://kit.svelte.dev/docs/testing)
- [Bun Test Runner](https://bun.sh/docs/cli/test)
