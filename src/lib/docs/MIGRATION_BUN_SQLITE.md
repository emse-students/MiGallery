# Migration vers bun:sqlite (Production)

## Contexte

MiGallery supporte maintenant **deux modes de runtime** :

- **Bun** : utilise `bun:sqlite` (driver natif, plus performant)
- **Node.js** : utilise `better-sqlite3` (compatible avec les versions existantes)

La détection du runtime est automatique. Aucune configuration n'est nécessaire.

## Pourquoi cette migration ?

Lors du déploiement sur `gallery.mitv.fr` avec Bun, l'erreur suivante apparaissait :

```
Error: better-sqlite3 is not yet supported in Bun
    at Module.require (node:module:90:18)
```

**Solution** : Utiliser `bun:sqlite` (driver natif de Bun) au lieu de `better-sqlite3` quand l'application tourne sous Bun.

## Changements apportés

### 1. `src/lib/db/database.ts`

- Ajout de la fonction `isBunRuntime()` pour détecter l'environnement
- Chargement conditionnel de `bun:sqlite` ou `better-sqlite3`
- Compatibilité API garantie entre les deux drivers

### 2. Scripts CLI (`.cjs`)

Les scripts suivants ont été mis à jour pour supporter les deux runtimes :

- `scripts/init-db.cjs`
- `scripts/inspect-db.cjs`
- `scripts/create-api-key.cjs`

> **Note** : `backup-db.cjs` n'a pas besoin de modification car il utilise uniquement `fs.copyFileSync()`.

## Configuration requise pour la production

### Fichier `.env` sur le serveur

Créez ou mettez à jour le fichier `.env` avec les variables suivantes :

```bash
# Auth.js (CRITIQUE - résout l'erreur UntrustedHost)
AUTH_SECRET=<générez avec: node scripts/generate_cookie_secret.cjs>
AUTH_TRUST_HOST=true
AUTH_URL=https://gallery.mitv.fr

# Base de données
DATABASE_PATH=./data/migallery.db

# Immich (optionnel)
IMMICH_BASE_URL=https://your-immich-instance.com
IMMICH_API_KEY=your-immich-api-key
```

### Variables critiques

| Variable          | Requis        | Description                                                                  |
| ----------------- | ------------- | ---------------------------------------------------------------------------- |
| `AUTH_SECRET`     | ✅ Oui        | Secret pour les cookies de session (généré par `generate_cookie_secret.cjs`) |
| `AUTH_TRUST_HOST` | ✅ Oui        | **Doit être `true` pour résoudre l'erreur `UntrustedHost`**                  |
| `AUTH_URL`        | ✅ Oui        | URL publique de l'application (`https://gallery.mitv.fr`)                    |
| `DATABASE_PATH`   | ⚠️ Recommandé | Chemin vers la base de données (par défaut : `./data/migallery.db`)          |

## Déploiement

### Étape 1 : Vérifier les variables d'environnement

```bash
# Sur le serveur de production
cd ~/migallery
cat .env
```

Assurez-vous que `AUTH_TRUST_HOST=true` et `AUTH_URL=https://gallery.mitv.fr` sont présents.

### Étape 2 : Pousser les changements

```bash
# Sur votre machine locale
git add .
git commit -m "Migration vers bun:sqlite pour compatibilité Bun"
git push origin main
```

Le déploiement via GitHub Actions se fait automatiquement.

### Étape 3 : Vérifier le déploiement

1. Consultez les logs GitHub Actions
2. Connectez-vous au serveur et vérifiez les logs PM2 :

```bash
pm2 logs migallery
```

3. Testez l'application : https://gallery.mitv.fr

### Étape 4 : Vérifier le runtime

Pour confirmer que Bun utilise bien `bun:sqlite`, ajoutez temporairement un log dans `src/lib/db/database.ts` :

```typescript
console.log(`[DB] Runtime: ${isBunRuntime() ? 'Bun (bun:sqlite)' : 'Node.js (better-sqlite3)'}`);
```

Puis vérifiez les logs :

```bash
pm2 logs migallery --lines 50
```

Vous devriez voir : `[DB] Runtime: Bun (bun:sqlite)`

## Résolution des problèmes

### Erreur : `UntrustedHost: Host must be trusted`

**Cause** : Auth.js refuse l'hôte `gallery.mitv.fr` car `AUTH_TRUST_HOST` n'est pas configuré.

**Solution** :

1. Ajoutez `AUTH_TRUST_HOST=true` dans `.env` sur le serveur
2. Ajoutez `AUTH_URL=https://gallery.mitv.fr` dans `.env`
3. Redémarrez l'application : `pm2 restart migallery`

### Erreur : `better-sqlite3 is not yet supported in Bun`

**Cause** : Le code essaie toujours d'utiliser `better-sqlite3` au lieu de `bun:sqlite`.

**Solution** :

1. Vérifiez que les changements ont bien été déployés
2. Vérifiez les logs pour confirmer le runtime détecté
3. Si le problème persiste, essayez : `pm2 delete migallery && pm2 start ecosystem.config.cjs`

### Erreur : Module `bun:sqlite` introuvable (en développement local)

**Cause** : Vous utilisez Node.js en local, mais le code essaie d'importer `bun:sqlite`.

**Solution** : Le code détecte automatiquement le runtime. Si vous voyez cette erreur, c'est que la détection échoue. Vérifiez que la fonction `isBunRuntime()` fonctionne correctement.

## Compatibilité

| Runtime     | Driver           | Statut      |
| ----------- | ---------------- | ----------- |
| Bun 1.3.2+  | `bun:sqlite`     | ✅ Supporté |
| Node.js 18+ | `better-sqlite3` | ✅ Supporté |

## Tests en local

### Avec Node.js (dev)

```bash
npm run dev
```

Le système utilisera automatiquement `better-sqlite3`.

### Avec Bun (simulation production)

```bash
bun run dev
```

Le système utilisera automatiquement `bun:sqlite`.

## Rollback (en cas de problème)

Si la migration pose problème en production, vous pouvez temporairement revenir à Node.js :

1. Sur le serveur, modifiez le processus PM2 pour utiliser Node.js :

```bash
pm2 delete migallery
pm2 start "node build/index.js" --name migallery
```

2. Le système utilisera automatiquement `better-sqlite3` avec Node.js

3. Investiguer le problème et corriger

4. Revenir à Bun une fois corrigé :

```bash
pm2 delete migallery
pm2 start ecosystem.config.cjs
```

## Support

En cas de problème, consultez les logs :

```bash
# Logs PM2
pm2 logs migallery --lines 100

# Logs GitHub Actions
# Voir : https://github.com/<votre-repo>/actions
```

---

**Date de migration** : 2025
**Version** : MiGallery 1.0.0
**Auteur** : GitHub Copilot
