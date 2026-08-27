<div align="center">
  <img src="static/MiGallery2.png" alt="MiGallery Logo" width="200"/>

# MiGallery

**by MiTV**

[![Built with SvelteKit](https://img.shields.io/badge/Built%20with-SvelteKit-FF3E00?logo=svelte)](https://kit.svelte.dev/)
[![Node.js](https://img.shields.io/badge/Node.js-22-339933?logo=node.js&logoColor=white)](https://nodejs.org/)

[![CI](https://github.com/emse-students/MiGallery/actions/workflows/ci.yml/badge.svg)](https://github.com/emse-students/MiGallery/actions/workflows/ci.yml)
[![Code Analysis](https://github.com/emse-students/MiGallery/actions/workflows/code-analysis.yml/badge.svg)](https://github.com/emse-students/MiGallery/actions/workflows/code-analysis.yml)

</div>

---

## 📋 Overview

MiGallery is a modern photo gallery web application built with **SvelteKit** running on **Node.js**. It allows managing albums, user permissions, and integrates with Immich for advanced photo management.

### ✨ Main Features

- 🖼️ **Album Management** - Create and organize albums with metadata
- 👥 **User Management** - Authentication and role system (admin, mitviste, user)
- 🔒 **Granular Permissions** - Access control by user or by tag (e.g., class year)
- 🎨 **Modern Interface** - Responsive design with Tailwind CSS
- 📸 **Immich Integration** - Synchronization with an Immich instance
- 💾 **SQLite Database** - High-performance local storage with better-sqlite3
- 📦 **Easy Deployment** - Complete packaging for simplified deployment
- 🔧 **Admin Interface** - DB management via browser (export/import/backup)

---

## 🚀 Installation

### Prerequisites

- **Node.js** >= 20
- SQLite (included with better-sqlite3)

Check Node.js:

```bash
node --version
```

### Installation Steps

1. **Clone the repository**

```bash
git clone https://github.com/emse-students/MiGallery.git
cd MiGallery
```

2. **Install dependencies**

```bash
bun install
```

3. **Configure the environment**

Create an `.env` file at the root:

```env
# Generate a secret for cookies and Auth.js
# bun run generate:secret
AUTH_SECRET=your_generated_secret

# Database
DATABASE_PATH=./data/migallery.db

# Immich Integration
IMMICH_BASE_URL=http://your-immich-url:2283
IMMICH_API_KEY=your_api_key

# EMSE CAS Authentication
CAS_CLIENT_ID=your_client_id
CAS_CLIENT_SECRET=your_client_secret
AUTH_TRUSTED_HOST=true # Set to true in production
```

4. **Initialize the database**

```bash
bun run db:init
```

This automatically creates:

- The table structure (users, albums, permissions)
- A system admin user: **les.roots@etu.emse.fr** (does not appear in the directory)

5. **Start the development server**

```bash
bun run dev
```

The application will be accessible at `http://localhost:5173`

---

## 🔧 Workflow

### Development

```bash
# Start the development server with HMR
bun run dev

# Check TypeScript and Svelte types
bun run check
```

### Production

```bash
# Compile the application for production
bun run build

# Preview the production version
bun run preview
```

---

## 🗄️ Database Maintenance

### Initialization

```bash
# Initialize a new database (if it doesn't exist)
bun run db:init
```

### Backups

#### Automatic backup (built-in)

Since version 1.1, **the server automatically performs a daily backup at midnight** without any
additional configuration. Backups are stored in `data/backups/` (max 10 files retained).

#### Manual backup

```bash
# Create a database backup
bun run db:backup
```

Backups are stored in `data/backups/` and only the **last 10** are kept.

#### Additional backups via cron (optional)

If you want redundancy (e.g., every 6 hours or export to remote storage), see
`src/lib/docs/CRON_SETUP.md`.

### Inspection and Repair

```bash
# Inspect the database and detect errors
bun run db:inspect

# Attempt to repair errors automatically
bun run db:inspect -- --repair
```

### Management via the admin interface

The admin interface (`/admin/database`) allows:

- ✅ Export the database
- ✅ Import a database
- ✅ Create a manual backup
- ✅ Restore a backup
- ✅ Inspect DB integrity
- ✅ View statistics (users, albums, size)

---

## 📜 Using Scripts

### Development Scripts

| Command           | Description                             |
| ----------------- | --------------------------------------- |
| `bun run dev`     | Starts the development server with HMR  |
| `bun run build`   | Compiles the application for production |
| `bun run preview` | Previews the production version         |
| `bun run check`   | Checks TypeScript and Svelte types      |

### Database Scripts

| Command                          | Description                |
| -------------------------------- | -------------------------- |
| `bun run db:init`                | Initializes a new database |
| `bun run db:backup`              | Creates a database backup  |
| `bun run db:inspect`             | Inspects the database      |
| `bun run db:inspect -- --repair` | Repairs detected errors    |

### Utility Scripts

| Command                   | Description                                           |
| ------------------------- | ----------------------------------------------------- |
| `bun run generate:secret` | Generates a cryptographic secret for cookies          |
| `bun run test:api`        | Runs the API unit tests                               |
| `bun run package`         | Creates a complete package (.tgz) with DB, .env, etc. |

### API Tests

```bash
# Tests with default URL (localhost:5173)
bun run test:api

# Tests with custom URL and API Key
API_BASE_URL=http://my-server:3000 API_KEY=my_key bun run test:api
```

Tests verify:

- ✅ Albums (listing, details)
- ✅ Users (listing, retrieval)
- ✅ Photos-CV (people, albums)
- ✅ API Keys (admin)
- ✅ Assets (Immich proxy)
- ✅ Health checks

---

## 📦 Packaging and Deployment

### Create a complete package

The `package` script creates a `.tgz` archive including:

- The compiled build
- The database (`data/`)
- The configuration file (`.env`)
- Utility scripts
- Documentation

```bash
bun run build
bun run package
```

The package will be created at `build/artifacts/migallery-<version>-full.tgz`

### Deploy on a new machine

1. **Copy the package** to the target machine

2. **Extract the archive**

```bash
tar -xzf migallery-x.x.x-full.tgz
cd migallery
```

3. **Install dependencies**

```bash
bun install --frozen-lockfile --production
```

4. **Check/Modify configuration**

```bash
nano .env  # Adjust URLs and paths if necessary
```

5. **Start the application**

```bash
node build/index.js
```

---

## 🏗️ Project Structure

```
MiGallery/
├─ .env                    # Configuration (not committed)
├─ package.json            # Dependencies and scripts
├─ svelte.config.js        # SvelteKit configuration
├─ vite.config.ts          # Vite configuration
├─ build/                  # Production build
│  ├─ artifacts/           # Packages (.tgz)
│  └─ ...
├─ data/                   # Database
│  ├─ migallery.db         # SQLite database
│  └─ backups/             # Automatic backups
├─ scripts/                # Utility scripts
│  ├─ init-db.cjs          # DB initialization
│  ├─ backup-db.cjs        # Manual DB backup
│  ├─ inspect-db.cjs       # DB inspection/repair
│  ├─ migrate-export-db.cjs  # Migration from old DB (one-time use)
├─ static/                 # Static files
└─ src/                    # Source code
   ├─ app.html             # Main HTML template
   ├─ hooks.server.ts      # Server hooks (auth, session...)
   ├─ lib/                 # Libraries and components
   │  ├─ components/       # Reusable Svelte components
   │  ├─ db/               # Schema and DB access
   │  ├─ auth/             # Authentication system
   │  ├─ immich/           # Immich integration
   │  └─ docs/             # Complete documentation
   └─ routes/              # SvelteKit routes
      ├─ +layout.svelte    # Global layout
      ├─ +page.svelte      # Home page
      ├─ admin/            # Admin interface
      ├─ albums/           # Album management
      ├─ trombinoscope/    # Directory page
      └─ api/              # API endpoints
```

---

## 👤 System User

A system admin user is automatically created during initialization:

- **ID** : `les.roots`
- **Email** : `les.roots@etu.emse.fr`
- **Role** : `admin`
- **Special note** : Does not appear in the directory (promo_year = null)

This user is intended for system administration and should not be deleted.

---

## 🔧 Technologies Used

- **[SvelteKit](https://kit.svelte.dev/)** - Modern, high-performance web framework
- **[Svelte 5](https://svelte.dev/)** - Reactive UI framework
- **[Vite](https://vitejs.dev/)** - Ultra-fast build tool
- **[Node.js](https://nodejs.org/)** - JavaScript runtime
- **[Tailwind CSS](https://tailwindcss.com/)** - Utility-first CSS framework
- **[Better-SQLite3](https://github.com/WiseLibs/better-sqlite3)** - Synchronous SQLite database
- **[Auth.js](https://authjs.dev/)** - Flexible authentication
- **[TypeScript](https://www.typescriptlang.org/)** - Static typing

---

## 📚 Complete Documentation

The reference technical documentation (English) can be found in
**[`docs/wiki/`](docs/wiki/index.md)** : architecture, authentication, Immich
proxy, albums and permissions, CV photos, downloads, data model,
API reference, deployment.

Other documents in the `docs/` folder:

### 📖 General Guides

- **SCRIPTS.md** - Detailed documentation of all scripts
- **CRON_SETUP.md** - Automatic backup configuration
- **NAVBAR_ACCESS_MATRIX.md** - Navigation bar access control matrix

### 🔐 API Documentation

- **API_SECURITY.md** - **[NEW]** Complete API security guide (scopes, permissions, examples)
- **POSTMAN_AVATAR.md** - **[NEW]** Postman guide for the avatar endpoint
- Web interface: `/admin` - Technical documentation (wiki) rendered from `docs/wiki/`

### 📝 Additional Resources

- **tests/README.md** - Automated testing guide (Vitest)
- `src/lib/admin/endpoints.ts` - TypeScript definition of all API endpoints

---

## 📄 License

This project is licensed under **PolyForm Noncommercial 1.0.0**: open source, non-commercial use
only. See the [LICENSE](LICENSE) file for more details.

MiGallery is an overlay that adds features on top of **[Immich](https://github.com/immich-app/immich)**,
a separate project licensed under **AGPL-3.0**. Integration is done solely via Immich's public HTTP
API (no Immich source code is included); Immich remains subject to its own AGPL-3.0 terms.

Credits : **MiTV** and **Les ROOTZ** (EMSE) - Jolan BOUDIN, with contributions by Gabriel DUPONT.

---

## 🛠️ Code Quality & Architecture

### Type System

The project uses a centralized and rigorous type system:

- **Single source**: All types are defined in `src/lib/types/api.ts`
- **Documentation**: Each interface is documented with JSDoc
- **Security**: Strict typing enabled in `tsconfig.json`

### DevOps & Linting

Code quality is ensured by a comprehensive tool chain:

- **oxlint**: Static code analysis over TS/JS
- **oxvelte**: Static analysis of Svelte templates
- **oxfmt**: Automatic code formatting
- **Husky**: Git hooks to check code before each commit
- **CI/CD**: Verification scripts (`bun run check`, `bun run lint`)

---

## 👨‍💻 Author

Developed with ❤️ by **[DeMASKe](https://github.com/DeMASKe)** and **[gd-pnjj](https://github.com/gd-pnjj)** for **MiTV**

- **Repository** : [github.com/emse-students/MiGallery](https://github.com/emse-students/MiGallery)
- **Organization** : EMSE Students

---

<div align="center">

**by MiTV @ EMSE**

</div>

---

## 🗂️ DevOps Appendices

<details>
<summary><strong>Quick Commands</strong></summary>

```powershell
# 1. Install pre-commit
pip install pre-commit

# 2. Install dependencies
bun install

# 3. Activate hooks
pre-commit install

# 4. Test
pre-commit run --all-files

# Check errors
bun run lint

# Auto-fix
bun run lint:fix
bun run format

# Commit (hooks run automatically)
git add .
git commit -m "message"
```

</details>

<details>
<summary><strong>DevOps Installation (summary)</strong></summary>

1. Check Python:

```powershell
python --version
# Should display Python 3.x
```

2. Express installation (summary):

```powershell
bun install
pre-commit install
pre-commit run --all-files
```

3. Verify:

```powershell
pre-commit run --all-files
bun run lint
```

</details>

<details>
<summary><strong>DevOps README (summary)</strong></summary>

Daily usage:

```powershell
bun run lint              # Check errors
bun run lint:fix          # Auto-fix
bun run format            # Format code
git commit -m "message"   # Hooks run automatically!
```

Important configuration files:

- `.oxlintrc.json` - oxlint configuration
- `oxvelte.config.json` - oxvelte configuration
- `oxfmt.json` - oxfmt configuration
- `.pre-commit-config.yaml` - pre-commit hooks
- `.editorconfig` - editor configuration

</details>

<details>
<summary><strong>Troubleshooting</strong></summary>

Common issues and quick solutions:

- `pre-commit: command not found`

```powershell
pip install --upgrade pre-commit
pre-commit --version
```

- `node: command not found` → Install Node.js from <https://nodejs.org>

- Hooks not running:

```powershell
pre-commit uninstall
pre-commit install
```

- Lint errors:

```powershell
bun run lint:fix
bun run format
```

- `Type tag 'typescript' is not recognized` :

```powershell
pip install --upgrade pre-commit identify
```

If a commit fails, fix the errors reported by oxlint/oxvelte then try again.

</details>
