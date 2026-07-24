# MiGallery - Technical Documentation

## 📖 Documentation Index

| Document                                             | Description                      |
| ---------------------------------------------------- | -------------------------------- |
| **README.md**                                        | This document - Project overview |
| [COMPONENTS.md](./COMPONENTS.md)                     | Reusable components guide        |
| [STYLES.md](./STYLES.md)                             | CSS and design system guide      |
| [SCRIPTS.md](./SCRIPTS.md)                           | Available utility scripts        |
| [CRON_SETUP.md](./CRON_SETUP.md)                     | CRON task configuration          |
| [NAVBAR_ACCESS_MATRIX.md](./NAVBAR_ACCESS_MATRIX.md) | Access matrix by role            |

> **API Documentation**: Available in the admin interface `/admin` (wiki rendering from `docs/wiki/`)

---

## Overview

MiGallery is a modern photo gallery for the students of École des Mines de Saint-Étienne (EMSE). The application allows managing, viewing, and downloading photos organized into albums, with a role-based permission system.

## Technical Stack

| Technology       | Version | Usage                       |
| ---------------- | ------- | --------------------------- |
| **SvelteKit**    | 2.x     | Full-stack framework        |
| **Svelte**       | 5.x     | UI framework with runes     |
| **Node.js**      | >= 20   | Runtime                     |
| **SQLite**       | -       | Local database              |
| **Tailwind CSS** | 3.x     | Utility-first CSS framework |
| **TypeScript**   | 5.x     | Static typing               |
| **Immich**       | -       | Media management backend    |

## Architecture

```
src/
├── lib/                    # Shared code
│   ├── components/         # Reusable Svelte components
│   ├── db/                 # Database access
│   ├── server/             # Server-side only code
│   ├── types/              # TypeScript definitions
│   ├── docs/               # Technical documentation
│   └── *.ts                # Utilities and stores
├── routes/                 # SvelteKit pages and API
│   ├── api/                # REST endpoints
│   ├── admin/              # Admin interface
│   ├── albums/             # Album management
│   └── ...                 # Other pages
└── app.css                 # Global styles
```

## User Roles

| Role       | Permissions                         |
| ---------- | ----------------------------------- |
| `user`     | View public albums, own photos      |
| `mitviste` | + Manage photos, create albums      |
| `admin`    | + Full management (users, settings) |

## Main Components

### UI Components (`src/lib/components/`)

- **`Modal.svelte`** - Generic modal with variants (confirm, warning, form)
- **`PhotosGrid.svelte`** - Photo grid with multi-selection
- **`PhotoModal.svelte`** - Full-screen photo viewer
- **`MobileNav.svelte`** - Mobile navigation (bottom bar)
- **`Icon.svelte`** - Lucide icons
- **`Toast.svelte`** - Notifications

### Stores & State

- **`photos.svelte.ts`** - Photo state (`PhotosState` class)
- **`toast.ts`** - Notification system
- **`confirm.ts`** - Confirmation dialogs
- **`theme.ts`** - Light/dark theme management

## API Endpoints

See detailed documentation in `docs/wiki/api-reference.md` (rendered on `/admin`).

### Main endpoints

| Method | Route              | Description     |
| ------ | ------------------ | --------------- |
| GET    | `/api/albums`      | Album list      |
| POST   | `/api/albums`      | Create an album |
| GET    | `/api/albums/[id]` | Album details   |
| DELETE | `/api/albums/[id]` | Delete an album |
| GET    | `/api/users`       | User list       |
| PUT    | `/api/users/[id]`  | Modify a user   |
| GET    | `/api/immich/*`    | Proxy to Immich |

## Database

### Main tables

```sql
-- Users
users (
  id_user TEXT PRIMARY KEY,
  email TEXT,
  prenom TEXT,
  nom TEXT,
  role TEXT DEFAULT 'user',
  photos_id TEXT,
  promo INTEGER
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

-- Album-user relationships
album_users (album_id, user_id)

-- Tags
album_tags (album_id, tag)
```

## Configuration

### Environment variables

```env
# Authentication
AUTH_SECRET=           # Session secret
AUTH_TRUST_HOST=true

# Immich
IMMICH_URL=           # Immich server URL
IMMICH_API_KEY=       # Immich API key

# Database
DATABASE_PATH=./data/migallery.db
```

## Available Scripts

```bash
npm run dev           # Development
npm run build         # Production build
npm run preview       # Preview
npm run check         # TypeScript check
npm run lint          # Linting
npm run lint:fix      # Linting with fixes
npm run db:init       # Initialize DB
npm run db:backup     # Backup DB
```

## Code Conventions

### Svelte 5 Runes

```svelte
<script lang="ts">
  // Local state with $state
  let count = $state(0);

  // Derivation with $derived
  let doubled = $derived(count * 2);

  // Props with $props
  let { name, onClose }: Props = $props();

  // Effects with $effect
  $effect(() => {
    console.log('count changed:', count);
  });
</script>
```

### Naming

- **Components**: PascalCase (`PhotosGrid.svelte`)
- **TS files**: kebab-case (`album-operations.ts`)
- **Variables**: camelCase
- **Constants**: SCREAMING_SNAKE_CASE

### CSS

- Use CSS variables defined in `app.css`
- Prefer Tailwind classes for layout
- Scoped CSS in components for specific styles

## Responsive Design

The application uses a mobile-first design with:

- Top navigation bar on desktop
- Fixed bottom navigation bar on mobile
- Main breakpoints: 480px, 768px, 1024px

## Security

- EMSE CAS authentication
- Signed cookies for session
- Role validation on every API endpoint
- Secure proxy to Immich (no direct exposure)

---

For more details, see the other documentation files in this folder.
