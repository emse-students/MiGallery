# Gestion de la Base de Données

Ce document explique comment gérer la base de données MiGallery, y compris les sauvegardes, les migrations et les réparations.

## Vue d'ensemble

MiGallery utilise une base de données SQLite locale pour stocker:

- Les informations utilisateurs
- Les albums et leurs permissions
- Les favoris par utilisateur
- Les clés API

## Admin Dashboard

L'interface d'administration `/admin/database` offre des outils pour gérer la base de données:

### Inspection de la Base de Données

Cliquez sur le bouton **🔍 Inspecter la DB** pour vérifier l'état de votre base de données.

L'inspection affiche:

- L'état général (Saine ✅ ou Incomplète ⚠️)
- La liste de toutes les tables
- Le nombre de lignes pour chaque table
- Les tables manquantes (le cas échéant)

### Réparation Automatique

Si l'inspection détecte des tables manquantes:

1. Cliquez sur **🔧 Réparer la DB**
2. Confirmez l'action dans la modal
3. Le système créera automatiquement les tables manquantes
4. **Aucune donnée existante ne sera affectée** (utilise `CREATE TABLE IF NOT EXISTS`)

## Commandes CLI

### Initialiser la Base de Données

```bash
npm run db:init
```

Crée une nouvelle base de données avec toutes les tables requises.

### Migrer la Base de Données

```bash
npm run db:migrate
```

Applique les migrations manquantes à une base de données existante:

- Crée les tables manquantes
- Ne modifie pas les tables existantes
- Affiche un résumé des actions

### Sauvegarder la Base de Données

```bash
npm run db:backup
```

Crée une sauvegarde horodatée de la base de données dans le dossier `data/backups/`.

Le système conserve automatiquement les 10 dernières sauvegardes.

### Inspecter la Base de Données

```bash
npm run db:inspect
```

Affiche des informations détaillées sur la structure et le contenu de la base de données.

## Schéma de la Base de Données

### Table `users`

Stocke les informations utilisateur:

```sql
CREATE TABLE users (
  id_user TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  prenom TEXT NOT NULL,
  nom TEXT NOT NULL,
  id_photos TEXT,
  first_login INTEGER DEFAULT 1,
  role TEXT DEFAULT 'user',
  promo_year INTEGER
)
```

### Table `albums`

Stocke les albums et leurs métadonnées:

```sql
CREATE TABLE albums (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  date TEXT,
  location TEXT,
  visibility TEXT NOT NULL DEFAULT 'authenticated',
  visible INTEGER NOT NULL DEFAULT 1
)
```

### Table `album_user_permissions`

Gère les permissions des utilisateurs sur les albums:

```sql
CREATE TABLE album_user_permissions (
  album_id TEXT NOT NULL,
  id_user TEXT NOT NULL,
  PRIMARY KEY (album_id, id_user),
  FOREIGN KEY(album_id) REFERENCES albums(id) ON DELETE CASCADE
)
```

### Table `album_tag_permissions`

Gère les permissions par balise (tag) sur les albums:

```sql
CREATE TABLE album_tag_permissions (
  album_id TEXT NOT NULL,
  tag TEXT NOT NULL,
  PRIMARY KEY (album_id, tag),
  FOREIGN KEY(album_id) REFERENCES albums(id) ON DELETE CASCADE
)
```

### Table `user_favorites`

Stocke les favoris par utilisateur:

```sql
CREATE TABLE user_favorites (
  user_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, asset_id),
  FOREIGN KEY(user_id) REFERENCES users(id_user) ON DELETE CASCADE
)
```

### Table `api_keys`

Stocke les clés API (créée automatiquement par le système):

```sql
CREATE TABLE api_keys (
  key_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  api_key TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id_user) ON DELETE CASCADE
)
```

## Déploiement

### Production

Pour assurer que la base de données est correctement configurée avant le démarrage de l'application:

```bash
npm run db:migrate && npm run build
```

Ou pendant le CI/CD:

```yaml
- name: Setup Database
  run: npm run db:migrate

- name: Build Application
  run: npm run build
```

### Configuration Docker

Si vous utilisez Docker, assurez-vous que:

1. Le volume de données persiste le fichier `data/migallery.db`
2. La migration s'exécute au démarrage du conteneur

Exemple Dockerfile:

```dockerfile
FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --production

COPY . .

# Migrer la base de données avant le démarrage
CMD npm run db:migrate && npm start
```

## Troubleshooting

### "Database error" au démarrage

**Cause:** La base de données existe mais certaines tables sont manquantes.

**Solution:** Exécutez la migration:

```bash
npm run db:migrate
```

### Restauration après une modification accidentelle

1. Naviguez vers `/admin/database`
2. Localisez la sauvegarde souhaitée dans la section "Sauvegardes disponibles"
3. Cliquez sur **🔄 Restaurer**
4. Confirmez l'action (cela remplacera la base actuelle)

### Import/Export

#### Exporter la Base de Données

1. Cliquez sur **📥 Exporter la DB** dans le dashboard admin
2. Le fichier `.db` sera téléchargé

#### Importer une Base de Données

⚠️ **ATTENTION:** L'import remplace complètement la base actuelle.

1. Créez d'abord une sauvegarde avec **💾 Sauvegarder maintenant**
2. Sélectionnez un fichier `.db` via le formulaire
3. Cliquez sur **📤 Importer la DB**
4. Confirmez l'action

## API Endpoints

### Inspection de la Base de Données

```
GET /admin/api/database
```

**Réponse:**

```json
{
	"success": true,
	"status": "healthy",
	"totalTables": 6,
	"requiredTables": 5,
	"tables": [
		{
			"name": "users",
			"exists": true,
			"rowCount": 8
		}
	],
	"missingTables": []
}
```

### Réparation de la Base de Données

```
POST /admin/api/database
```

**Réponse:**

```json
{
  "success": true,
  "message": "Migration terminée",
  "results": [
    {
      "table": "users",
      "success": true,
      "message": "Créée ou vérifiée"
    }
  ],
  "newStatus": [...]
}
```

## Best Practices

### Sauvegardes Régulières

- Créez des sauvegardes avant les migrations importantes
- Testez les restaurations régulièrement
- Conservez les sauvegardes anciennes pour les audits

### Migration en Production

1. Créez une sauvegarde
2. Testez la migration dans un environnement de staging
3. Exécutez la migration en production avec `npm run db:migrate`
4. Vérifiez l'intégrité avec l'inspection

### Performance

- Indexez les colonnes fréquemment interrogées
- Archivez les anciennes données si la DB devient trop volumineuse
- Utilisez les favoris localement pour éviter les requêtes répétées

## Support

Pour plus d'informations sur la structure de la base de données, consultez:

- `src/lib/db/schema.sql` - Schéma complet
- `scripts/migrate-db.cjs` - Script de migration
- `src/routes/admin/api/database/+server.ts` - API de gestion
