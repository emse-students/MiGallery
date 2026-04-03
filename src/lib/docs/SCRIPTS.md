# Scripts MiGallery - Documentation

Ce dossier contient tous les scripts utilitaires pour gérer MiGallery.

---

## 📚 Liste des scripts

### 🗄️ Gestion de la base de données

#### `init-db.cjs` - Initialisation de la base de données

**Utilisation** : `bun run db:init` ou `node scripts/init-db.cjs`

**Description** :

- Crée une nouvelle base de données SQLite si elle n'existe pas
- Applique le schéma complet (tables, contraintes, indexes)
- Crée l'utilisateur système admin (`les.roots@etu.emse.fr`)
- N'écrase PAS une base de données existante (sécurité)

**Quand l'utiliser** :

- ✅ Installation sur une nouvelle machine
- ✅ Première configuration de l'application
- ✅ Après avoir supprimé/corrompu la base de données

**Important** :

- Ce script refuse de s'exécuter si une base de données existe déjà
- Pour réinitialiser, supprimez d'abord `data/migallery.db`

---

#### `backup-db.cjs` - Sauvegarde de la base de données

**Utilisation** : `bun run db:backup` ou `node scripts/backup-db.cjs`

> **✨ Sauvegarde automatique** : depuis la version actuelle, le serveur déclenche automatiquement une sauvegarde
> quotidienne à minuit dès son démarrage (`src/lib/server/backup.ts` → `startBackupScheduler()`). **Aucun cron
> extérieur n'est nécessaire.** Le script ci-dessous reste utile pour des sauvegardes manuelles ponctuelles.

**Description** :

- Crée une copie de la base de données avec timestamp
- Conserve uniquement les 10 dernières sauvegardes
- Supprime automatiquement les anciennes sauvegardes
- Affiche la taille du fichier créé

**Quand l'utiliser** :

- ✅ Avant une mise à jour importante
- ✅ Avant des modifications massives de données
- ✅ Avant de tester le script de réparation

**Emplacement des sauvegardes** : `data/backups/`

**Format des fichiers** : `migallery_backup_YYYY-MM-DD_HH-MM-SS.db`

---

#### `inspect-db.cjs` - Inspection et réparation de la base de données

**Utilisation** :

- Inspection : `bun run db:inspect`
- Réparation : `bun run db:inspect -- --repair`

**Description** :

- Vérifie l'intégrité de la base de données (PRAGMA integrity_check)
- Contrôle la présence de toutes les tables attendues
- Vérifie les contraintes de clés étrangères
- Affiche des statistiques (nombre d'utilisateurs, albums, etc.)
- Vérifie l'utilisateur système admin
- Peut tenter de réparer automatiquement certaines erreurs

**Quand l'utiliser** :

- ✅ En cas d'erreur suspecte dans l'application
- ✅ Après une panne ou arrêt brutal
- ✅ Pour vérifier la santé de la DB régulièrement
- ✅ Avant une migration importante

**Mode réparation** :

- Recrée l'utilisateur système s'il est manquant
- Corrige le rôle de l'utilisateur système
- Propose de sauvegarder et réinitialiser en cas d'erreur irréparable

**Erreurs détectées** :

- ❌ Problèmes d'intégrité SQLite
- ❌ Tables manquantes
- ❌ Violations de clés étrangères
- ❌ Utilisateur système manquant ou incorrect

---

### 🔒 Sécurité

#### `generate_cookie_secret.cjs` - Génération de secret cryptographique

**Utilisation** : `bun run generate:secret` ou `node scripts/generate_cookie_secret.cjs`

**Description** :

- Génère un secret cryptographique sécurisé (32 bytes)
- Utilise `crypto.randomBytes()` pour un vrai aléatoire
- Encode en base64url (compatible avec les variables d'environnement)

**Quand l'utiliser** :

- ✅ Lors de la première installation
- ✅ Pour renouveler le secret périodiquement (sécurité)
- ✅ Après une compromission potentielle

**Exemple d'utilisation** :

```bash
# Générer et copier dans .env
echo "COOKIE_SECRET=$(bun run generate:secret)" >> .env
```

**Important** :

- ⚠️ Changer le secret invalide toutes les sessions utilisateurs
- ⚠️ Gardez ce secret confidentiel (ne jamais le committer)

---

### 📦 Packaging et déploiement

#### `pack-bun.js` - Création d'un package complet

**Utilisation** : `bun run package` ou `bun scripts/pack-bun.js`

**Description** :

- Crée une archive `.tgz` complète de l'application
- Inclut : build/, data/, .env, scripts/, README.md, package.json
- Prêt pour un déploiement sur une autre machine
- Génère un nom de fichier avec la version du package

**Quand l'utiliser** :

- ✅ Pour déployer sur un serveur de production
- ✅ Pour créer une release
- ✅ Pour sauvegarder l'état complet de l'application
- ✅ Pour migrer vers une nouvelle machine

**Fichier créé** : `build/artifacts/migallery-<version>-full.tgz`

**Prérequis** :

- Avoir exécuté `bun run build` au préalable
- Avoir configuré `.env` et la base de données

**Déploiement** :

```bash
# Sur la machine cible
tar -xzf migallery-x.x.x-full.tgz
cd migallery
bun install --production
# Vérifier/adapter .env si nécessaire
bun run build/index.js
```

---

## 🔄 Workflow recommandé

### Installation initiale (nouvelle machine)

```bash
# 1. Cloner et installer
git clone https://github.com/emse-students/MiGallery.git
cd MiGallery
bun install

# 2. Configurer l'environnement
bun run generate:secret  # Copier la sortie
nano .env  # Créer et remplir avec les variables

# 3. Initialiser la base de données
bun run db:init

# 4. La sauvegarde automatique est gérée par le serveur (startBackupScheduler).
#    Elle se déclenche à minuit dès le démarrage — rien à configurer.

# 5. Lancer l'application
bun run dev  # Développement
# ou
bun run build && bun run build/index.js  # Production
```

### Maintenance régulière

```bash
# Vérifier la santé de la DB (mensuel recommandé)
bun run db:inspect

# Créer une sauvegarde manuelle avant une grosse opération
bun run db:backup

# Vérifier les sauvegardes automatiques
ls -lh data/backups/
```

### Avant une mise à jour majeure

```bash
# 1. Sauvegarder la base de données
bun run db:backup

# 2. Créer un package complet (snapshot)
bun run build
bun run package

# 3. Vérifier l'intégrité
bun run db:inspect

# 4. Procéder à la mise à jour
git pull
bun install
bun run build
```

### En cas de problème

```bash
# 1. Inspecter et diagnostiquer
bun run db:inspect

# 2. Tenter une réparation automatique
bun run db:inspect -- --repair

# 3. Si échec : sauvegarder et réinitialiser
cp data/migallery.db data/migallery.db.corrupt
bun run db:init
# Puis restaurer les données manuellement ou depuis une sauvegarde
```

---

## 📋 Variables d'environnement utilisées

Les scripts utilisent les variables d'environnement suivantes :

| Variable          | Description                  | Valeur par défaut     | Utilisé par             |
| ----------------- | ---------------------------- | --------------------- | ----------------------- |
| `DATABASE_PATH`   | Chemin de la base de données | `./data/migallery.db` | Tous les scripts DB     |
| `BACKUP_DIR`      | Dossier des sauvegardes      | `./data/backups`      | backup-db.cjs           |
| `IMMICH_BASE_URL` | URL de l'instance Immich     | -                     | init-db.cjs (optionnel) |
| `IMMICH_API_KEY`  | Clé API Immich               | -                     | init-db.cjs (optionnel) |

---

## 🛠️ Dépendances

Les scripts nécessitent les packages suivants (installés automatiquement) :

- **better-sqlite3** - Interface SQLite pour Node.js
- **tar** - Création d'archives (pack-bun.js)
- **crypto** (natif) - Génération de secrets

---

## 📞 Support

En cas de problème avec les scripts :

1. Vérifier les logs d'erreur
2. Consulter la documentation dans `README.md`
3. Vérifier les permissions (lecture/écriture sur `data/`)
4. Ouvrir une issue sur GitHub

---

## 🔐 Sécurité

**Fichiers sensibles** (NE JAMAIS COMMITTER) :

- `.env` - Configuration et secrets
- `data/migallery.db` - Base de données
- `data/backups/*.db` - Sauvegardes
- `build/artifacts/*.tgz` - Packages incluant .env et DB

Ajoutés au `.gitignore` :

```
.env
data/
build/
```

---

## ✅ Checklist de déploiement

Avant de déployer en production :

- [ ] Base de données initialisée (`bun run db:init`)
- [ ] Secret cookie généré et configuré dans `.env`
- [ ] Variables Immich configurées dans `.env`
- [ ] Test de l'application en local (`bun run dev`)
- [ ] Build de production réussie (`bun run build`)
- [ ] Inspection de la DB sans erreur (`bun run db:inspect`)
- [ ] Package complet créé (`bun run package`)
- [ ] Vérifier que les sauvegardes automatiques se créent bien dans `data/backups/` après minuit

---

**Documentation à jour : Avril 2026**
