# MiGallery - Documentation Technique

## 📖 Index de la Documentation

| Document                                             | Description                            |
| ---------------------------------------------------- | -------------------------------------- |
| **README.md**                                        | Ce document - Vue d'ensemble du projet |
| [COMPONENTS.md](./COMPONENTS.md)                     | Guide des composants réutilisables     |
| [STYLES.md](./STYLES.md)                             | Guide CSS et système de design         |
| [SCRIPTS.md](./SCRIPTS.md)                           | Scripts utilitaires disponibles        |
| [CRON_SETUP.md](./CRON_SETUP.md)                     | Configuration des tâches CRON          |
| [NAVBAR_ACCESS_MATRIX.md](./NAVBAR_ACCESS_MATRIX.md) | Matrice d'accès selon les rôles        |

> **Documentation API** : Disponible dans l'interface admin `/admin/api-docs`

---

## Vue d'ensemble

MiGallery est une galerie photo moderne pour les étudiants de l'École des Mines de Saint-Étienne (EMSE). L'application permet de gérer, visualiser et télécharger des photos organisées en albums, avec un système de droits basé sur les rôles.

## Stack Technique

| Technologie      | Version | Usage                         |
| ---------------- | ------- | ----------------------------- |
| **SvelteKit**    | 2.x     | Framework full-stack          |
| **Svelte**       | 5.x     | Framework UI avec runes       |
| **Node.js**      | >= 20   | Runtime                       |
| **SQLite**       | -       | Base de données locale        |
| **Tailwind CSS** | 3.x     | Framework CSS utilitaire      |
| **TypeScript**   | 5.x     | Typage statique               |
| **Immich**       | -       | Backend de gestion des médias |

## Architecture

```
src/
├── lib/                    # Code partagé
│   ├── components/         # Composants Svelte réutilisables
│   ├── db/                 # Accès base de données
│   ├── server/             # Code côté serveur uniquement
│   ├── types/              # Définitions TypeScript
│   ├── docs/               # Documentation technique
│   └── *.ts                # Utilitaires et stores
├── routes/                 # Pages et API SvelteKit
│   ├── api/                # Endpoints REST
│   ├── admin/              # Interface d'administration
│   ├── albums/             # Gestion des albums
│   └── ...                 # Autres pages
└── app.css                 # Styles globaux
```

## Rôles Utilisateur

| Rôle       | Droits                                           |
| ---------- | ------------------------------------------------ |
| `user`     | Consulter les albums publics, ses propres photos |
| `mitviste` | + Gérer les photos, créer des albums             |
| `admin`    | + Gestion complète (utilisateurs, paramètres)    |

## Composants Principaux

### UI Components (`src/lib/components/`)

- **`Modal.svelte`** - Modal générique avec variantes (confirm, warning, form)
- **`PhotosGrid.svelte`** - Grille de photos avec sélection multiple
- **`PhotoModal.svelte`** - Visualisation photo plein écran
- **`MobileNav.svelte`** - Navigation mobile (barre en bas)
- **`Icon.svelte`** - Icônes Lucide
- **`Toast.svelte`** - Notifications

### Stores & State

- **`photos.svelte.ts`** - État des photos (classe `PhotosState`)
- **`toast.ts`** - Système de notifications
- **`confirm.ts`** - Dialogues de confirmation
- **`theme.ts`** - Gestion du thème clair/sombre

## API Endpoints

Voir la documentation détaillée dans `src/routes/admin/api-docs/`.

### Principaux endpoints

| Méthode | Route              | Description             |
| ------- | ------------------ | ----------------------- |
| GET     | `/api/albums`      | Liste des albums        |
| POST    | `/api/albums`      | Créer un album          |
| GET     | `/api/albums/[id]` | Détails d'un album      |
| DELETE  | `/api/albums/[id]` | Supprimer un album      |
| GET     | `/api/users`       | Liste des utilisateurs  |
| PUT     | `/api/users/[id]`  | Modifier un utilisateur |
| GET     | `/api/immich/*`    | Proxy vers Immich       |

## Base de Données

### Tables principales

```sql
-- Utilisateurs
users (
  id_user TEXT PRIMARY KEY,
  email TEXT,
  prenom TEXT,
  nom TEXT,
  role TEXT DEFAULT 'user',
  id_photos TEXT,
  promo_year INTEGER
)

-- Albums
albums (
  id TEXT PRIMARY KEY,
  name TEXT,
  date TEXT,
  location TEXT,
  visibility TEXT DEFAULT 'private',
  visible INTEGER DEFAULT 1
)

-- Relations album-utilisateur
album_users (album_id, user_id)

-- Tags
album_tags (album_id, tag)
```

## Configuration

### Variables d'environnement

```env
# Authentification
AUTH_SECRET=           # Secret pour les sessions
AUTH_TRUST_HOST=true

# Immich
IMMICH_URL=           # URL du serveur Immich
IMMICH_API_KEY=       # Clé API Immich

# Base de données
DATABASE_PATH=./data/migallery.db
```

## Scripts disponibles

```bash
npm run dev           # Développement
npm run build         # Build production
npm run preview       # Prévisualisation
npm run check         # Vérification TypeScript
npm run lint          # Linting
npm run lint:fix      # Linting avec corrections
npm run db:init       # Initialiser la DB
npm run db:backup     # Sauvegarder la DB
```

## Conventions de Code

### Svelte 5 Runes

```svelte
<script lang="ts">
  // État local avec $state
  let count = $state(0);

  // Dérivation avec $derived
  let doubled = $derived(count * 2);

  // Props avec $props
  let { name, onClose }: Props = $props();

  // Effets avec $effect
  $effect(() => {
    console.log('count changed:', count);
  });
</script>
```

### Nommage

- **Composants** : PascalCase (`PhotosGrid.svelte`)
- **Fichiers TS** : kebab-case (`album-operations.ts`)
- **Variables** : camelCase
- **Constantes** : SCREAMING_SNAKE_CASE

### CSS

- Utiliser les variables CSS définies dans `app.css`
- Préférer les classes Tailwind pour le layout
- CSS scoped dans les composants pour les styles spécifiques

## Responsive Design

L'application utilise un design mobile-first avec :

- Barre de navigation en haut sur desktop
- Barre de navigation fixe en bas sur mobile
- Breakpoints principaux : 480px, 768px, 1024px

## Sécurité

- Authentification CAS EMSE
- Cookies signés pour la session
- Validation des rôles sur chaque endpoint API
- Proxy sécurisé vers Immich (pas d'exposition directe)

---

Pour plus de détails, consultez les autres fichiers de documentation dans ce dossier.
