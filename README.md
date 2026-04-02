<div align="center">
  <img src="static/MiGallery2.png" alt="MiGallery Logo" width="200"/>

# MiGallery

**by MiTV**

[![Built with SvelteKit](https://img.shields.io/badge/Built%20with-SvelteKit-FF3E00?logo=svelte)](https://kit.svelte.dev/)
[![Powered by Bun](https://img.shields.io/badge/Powered%20by-Bun-000000?logo=bun)](https://bun.sh/)

[![CI (Bun)](https://github.com/emse-students/MiGallery/actions/workflows/ci-bun.yml/badge.svg)](https://github.com/emse-students/MiGallery/actions/workflows/ci-bun.yml)
[![Code Analysis](https://github.com/emse-students/MiGallery/actions/workflows/code-analysis.yml/badge.svg)](https://github.com/emse-students/MiGallery/actions/workflows/code-analysis.yml)
[![Documentation](https://github.com/emse-students/MiGallery/actions/workflows/docs.yml/badge.svg)](https://github.com/emse-students/MiGallery/actions/workflows/docs.yml)

</div>

---

## 📋 Vue d'ensemble

MiGallery est une application web moderne de gestion de galeries photos, développée avec **SvelteKit** et optimisée pour **Bun**. Elle permet de gérer des albums, des permissions utilisateurs, et s'intègre avec Immich pour la gestion avancée des photos.

### ✨ Fonctionnalités principales

- 🖼️ **Gestion d'albums** - Création et organisation d'albums avec métadonnées
- 👥 **Gestion des utilisateurs** - Système d'authentification et de rôles (admin, mitviste, user)
- 🔒 **Permissions granulaires** - Contrôle d'accès par utilisateur ou par tag (ex: promo)
- 🎨 **Interface moderne** - Design responsive avec Tailwind CSS
- 📸 **Intégration Immich** - Synchronisation avec une instance Immich
- 💾 **Base de données SQLite** - Stockage local performant avec better-sqlite3
- 📦 **Déploiement facile** - Packaging complet pour déploiement simplifié
- 🔧 **Interface admin** - Gestion de la DB via navigateur (export/import/sauvegarde)

---

## 🚀 Installation

### Prérequis

- **Bun** (recommandé) ou Node.js >= 18
- SQLite (inclus avec better-sqlite3)

Vérifier Bun :

```bash
bun --version
```

### Étapes d'installation

1. **Cloner le dépôt**

```bash
git clone https://github.com/emse-students/MiGallery.git
cd MiGallery
```

2. **Installer les dépendances**

```bash
bun install
```

3. **Configurer l'environnement**

Créez un fichier `.env` à la racine :

```env
# Générer un secret pour les cookies et Auth.js
# bun run generate:secret
COOKIE_SECRET=votre_secret_genere
AUTH_SECRET=votre_secret_genere

# Base de données
DATABASE_PATH=./data/migallery.db

# Intégration Immich
IMMICH_BASE_URL=http://votre-immich-url:2283
IMMICH_API_KEY=votre_api_key

# Authentification MiConnect (Authentik OIDC)
MICONNECT_ISSUER=https://auth.canari-emse.fr/application/o/migallery/
MICONNECT_CLIENT_ID=votre_client_id
MICONNECT_CLIENT_SECRET=votre_client_secret
AUTH_TRUSTED_HOST=true # Mettre à true en production
```

4. **Initialiser la base de données**

```bash
bun run db:init
```

Cela crée automatiquement :

- La structure des tables (users, albums, permissions)
- Un utilisateur système admin : **dd68bb5b4f7c56878a1bd873593a3e7c3434242c80871e4ead9fe99d3f48a782@miconnect.local** (n'apparaît pas sur le trombinoscope)

5. **Lancer le serveur de développement**

```bash
bun run dev
```

L'application sera accessible sur `http://localhost:5173`

---

## 🔧 Fonctionnement

### Développement

```bash
# Lancer le serveur de développement avec HMR
bun run dev

# Vérifier les types TypeScript et Svelte
bun run check
```

### Production

```bash
# Compiler l'application pour la production
bun run build

# Prévisualiser la version de production
bun run preview
```

---

## 🗄️ Maintenance de la base de données

### Initialisation

```bash
# Initialiser une nouvelle base de données (si elle n'existe pas)
bun run db:init
```

### Sauvegardes

#### Sauvegarde manuelle

```bash
# Créer une sauvegarde de la base de données
bun run db:backup
```

Les sauvegardes sont stockées dans `data/backups/` et seules les **10 dernières** sont conservées.

#### Sauvegardes automatiques

Pour configurer des sauvegardes automatiques quotidiennes à minuit :

**Sur Linux/Mac (cron)** :

```bash
crontab -e
# Ajouter cette ligne :
0 0 * * * cd /chemin/vers/MiGallery && bun run db:backup
```

**Sur Windows (Planificateur de tâches)** :

1. Ouvrir le Planificateur de tâches
2. Créer une tâche de base
3. Déclencheur : Quotidien à 00:00
4. Action : Démarrer un programme
   - Programme : `bun`
   - Arguments : `run db:backup`
   - Répertoire : `C:\chemin\vers\MiGallery`

Consultez `src/lib/docs/CRON_SETUP.md` pour plus de détails.

### Inspection et réparation

```bash
# Inspecter la base de données et détecter les erreurs
bun run db:inspect

# Tenter de réparer les erreurs automatiquement
bun run db:inspect -- --repair
```

### Gestion via l'interface admin

L'interface d'administration (`/admin/database`) permet de :

- ✅ Exporter la base de données
- ✅ Importer une base de données
- ✅ Créer une sauvegarde manuelle
- ✅ Restaurer une sauvegarde
- ✅ Inspecter l'intégrité de la DB
- ✅ Voir les statistiques (utilisateurs, albums, taille)

---

## 📜 Utilisation des scripts

### Scripts de développement

| Commande          | Description                                |
| ----------------- | ------------------------------------------ |
| `bun run dev`     | Lance le serveur de développement avec HMR |
| `bun run build`   | Compile l'application pour la production   |
| `bun run preview` | Prévisualise la version de production      |
| `bun run check`   | Vérifie les types TypeScript et Svelte     |

### Scripts de base de données

| Commande                         | Description                               |
| -------------------------------- | ----------------------------------------- |
| `bun run db:init`                | Initialise une nouvelle base de données   |
| `bun run db:backup`              | Crée une sauvegarde de la base de données |
| `bun run db:inspect`             | Inspecte la base de données               |
| `bun run db:inspect -- --repair` | Répare les erreurs détectées              |

### Scripts utilitaires

| Commande                  | Description                                        |
| ------------------------- | -------------------------------------------------- |
| `bun run generate:secret` | Génère un secret cryptographique pour les cookies  |
| `bun run test:api`        | Lance les tests unitaires de l'API                 |
| `bun run package`         | Crée un package complet (.tgz) avec DB, .env, etc. |

### Tests de l'API

```bash
# Tests avec l'URL par défaut (localhost:5173)
bun run test:api

# Tests avec une URL personnalisée et API Key
API_BASE_URL=http://mon-serveur:3000 API_KEY=ma_cle bun run test:api
```

Les tests vérifient :

- ✅ Albums (listing, détails)
- ✅ Users (listing, récupération)
- ✅ Photos-CV (personnes, albums)
- ✅ API Keys (admin)
- ✅ Assets (proxy Immich)
- ✅ Health checks

---

## 📦 Packaging et déploiement

### Créer un package complet

Le script `package` crée une archive `.tgz` incluant :

- Le build compilé
- La base de données (`data/`)
- Le fichier de configuration (`.env`)
- Les scripts utilitaires
- La documentation

```bash
bun run build
bun run package
```

Le package sera créé dans `build/artifacts/migallery-<version>-full.tgz`

### Déployer sur une nouvelle machine

1. **Copier le package** sur la machine cible

2. **Extraire l'archive**

```bash
tar -xzf migallery-x.x.x-full.tgz
cd migallery
```

3. **Installer les dépendances**

```bash
bun install --production
```

4. **Vérifier/Modifier la configuration**

```bash
nano .env  # Adapter les URLs et chemins si nécessaire
```

5. **Lancer l'application**

```bash
bun run build/index.js
```

---

## 🏗️ Structure du projet

```
MiGallery/
├─ .env                    # Configuration (non committé)
├─ package.json            # Dépendances et scripts
├─ svelte.config.js        # Configuration SvelteKit
├─ vite.config.ts          # Configuration Vite
├─ build/                  # Build de production
│  ├─ artifacts/           # Packages (.tgz)
│  └─ ...
├─ data/                   # Base de données
│  ├─ migallery.db         # Base SQLite
│  └─ backups/             # Sauvegardes automatiques
├─ scripts/                # Scripts utilitaires
│  ├─ init-db.cjs          # Initialisation DB
│  ├─ backup-db.cjs        # Sauvegarde DB
│  ├─ inspect-db.cjs       # Inspection/réparation DB
│  ├─ test-api.cjs         # Tests unitaires API
│  ├─ generate_cookie_secret.cjs  # Génération secret
│  └─ pack-bun.js          # Packaging complet
├─ static/                 # Fichiers statiques
└─ src/                    # Code source
   ├─ app.html             # Template HTML principal
   ├─ hooks.server.ts      # Hooks serveur (auth, session...)
   ├─ lib/                 # Bibliothèques et composants
   │  ├─ components/       # Composants Svelte réutilisables
   │  ├─ db/               # Schéma et accès DB
   │  ├─ auth/             # Système d'authentification
   │  ├─ immich/           # Intégration Immich
   │  └─ docs/             # Documentation complète
   └─ routes/              # Routes SvelteKit
      ├─ +layout.svelte    # Layout global
      ├─ +page.svelte      # Page d'accueil
      ├─ admin/            # Interface admin
      ├─ albums/           # Gestion des albums
      ├─ trombinoscope/    # Page trombinoscope
      └─ api/              # Endpoints API
```

---

## 👤 Utilisateur système

Un utilisateur système admin est créé automatiquement lors de l'initialisation :

- **ID** : `dd68bb5b4f7c56878a1bd873593a3e7c3434242c80871e4ead9fe99d3f48a782`
- **Email** : `dd68bb5b4f7c56878a1bd873593a3e7c3434242c80871e4ead9fe99d3f48a782@miconnect.local`
- **Rôle** : `admin`
- **Particularité** : N'apparaît pas sur le trombinoscope (promo_year = null)

Cet utilisateur est destiné à l'administration système et ne doit pas être supprimé.

---

## 🔧 Technologies utilisées

- **[SvelteKit](https://kit.svelte.dev/)** - Framework web moderne et performant
- **[Svelte 5](https://svelte.dev/)** - Framework UI réactif
- **[Vite](https://vitejs.dev/)** - Build tool ultra-rapide
- **[Bun](https://bun.sh/)** - Runtime JavaScript performant
- **[Tailwind CSS](https://tailwindcss.com/)** - Framework CSS utilitaire
- **[Better-SQLite3](https://github.com/WiseLibs/better-sqlite3)** - Base de données SQLite synchrone
- **[Auth.js](https://authjs.dev/)** - Authentification flexible
- **[TypeScript](https://www.typescriptlang.org/)** - Typage statique

---

## 📚 Documentation complète

La documentation complète se trouve dans le dossier `docs/` :

### 📖 Guides généraux

- **SCRIPTS.md** - Documentation détaillée de tous les scripts
- **CRON_SETUP.md** - Configuration des sauvegardes automatiques
- **NAVBAR_ACCESS_MATRIX.md** - Matrice de contrôle d'accès de la barre de navigation

### 🔐 Documentation API

- **API_SECURITY.md** - **[NOUVEAU]** Guide complet de sécurité API (scopes, permissions, exemples)
- **POSTMAN_AVATAR.md** - **[NOUVEAU]** Guide Postman pour l'endpoint avatar
- Interface web : `/admin/api-docs` - Documentation interactive des endpoints

### 📝 Ressources additionnelles

- **tests/README.md** - Guide des tests automatisés (Vitest)
- `src/lib/admin/endpoints.ts` - Définition TypeScript de tous les endpoints API

---

## 📄 Licence

Ce projet est sous licence **GNU GPL v3**. Voir le fichier [LICENSE](LICENSE) pour plus de détails.

---

## 🛠️ Qualité du Code & Architecture

### Système de Types

Le projet utilise un système de types centralisé et rigoureux :

- **Source unique** : Tous les types sont définis dans `src/lib/types/api.ts`
- **Documentation** : Chaque interface est documentée avec JSDoc
- **Sécurité** : Typage strict activé dans `tsconfig.json`

### DevOps & Linting

La qualité du code est assurée par une chaîne d'outils complète :

- **ESLint** : Analyse statique du code (configuration stricte)
- **Prettier** : Formatage automatique du code
- **Husky** : Hooks git pour vérifier le code avant chaque commit
- **CI/CD** : Scripts de vérification (`bun run check`, `bun run lint`)

---

## 👨‍💻 Auteur

Développé avec ❤️ par **[DeMASKe](https://github.com/DeMASKe)** et **[gd-pnjj](https://github.com/gd-pnjj)** pour **MiTV**

- **Repository** : [github.com/emse-students/MiGallery](https://github.com/emse-students/MiGallery)
- **Organisation** : EMSE Students

---

<div align="center">

**by MiTV @ EMSE**

</div>

---

## 🗂️ Annexes DevOps

<details>
<summary><strong>Commandes rapides</strong></summary>

```powershell
# 1. Installer pre-commit
pip install pre-commit

# 2. Installer dépendances
bun install

# 3. Activer les hooks
pre-commit install

# 4. Tester
pre-commit run --all-files

# Vérifier les erreurs
bun run lint

# Corriger automatiquement
bun run lint:fix
bun run format

# Commiter (hooks s'exécutent automatiquement)
git add .
git commit -m "message"
```

</details>

<details>
<summary><strong>Installation DevOps (résumé)</strong></summary>

1. Vérifier Python :

```powershell
python --version
# Doit afficher Python 3.x
```

2. Installation express (résumé) :

```powershell
bun install
pre-commit install
pre-commit run --all-files
```

3. Vérifier :

```powershell
pre-commit run --all-files
bun run lint
```

</details>

<details>
<summary><strong>DevOps README (résumé)</strong></summary>

Usage quotidien :

```powershell
bun run lint              # Vérifier les erreurs
bun run lint:fix          # Corriger automatiquement
bun run format            # Formater le code
git commit -m "message"   # Les hooks s'exécutent automatiquement !
```

Fichiers de configuration importants :

- `eslint.config.js` - Configuration ESLint
- `.prettierrc` - Prettier
- `.pre-commit-config.yaml` - pre-commit hooks
- `.editorconfig` - configuration éditeur

</details>

<details>
<summary><strong>Dépannage & Troubleshooting</strong></summary>

Problèmes courants et solutions rapides :

- `pre-commit: command not found`

```powershell
pip install --upgrade pre-commit
pre-commit --version
```

- `bun: command not found` → Installez Bun depuis <https://bun.sh>

- Les hooks ne s'exécutent pas :

```powershell
pre-commit uninstall
pre-commit install
```

- Erreurs ESLint au linting :

```powershell
bun run lint:fix
bun run format
```

- `Type tag 'typescript' is not recognized` :

```powershell
pip install --upgrade pre-commit identify
```

Si un commit échoue, corrigez les erreurs reportées par ESLint/Prettier puis réessayez.

</details>
