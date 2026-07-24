# MiGallery Scripts - Documentation

This folder contains all utility scripts for managing MiGallery.

---

## 📚 Script list

### 🗄️ Database management

#### `init-db.cjs` - Database initialization

**Usage**: `npm run db:init` or `node scripts/init-db.cjs`

**Description**:

- Creates a new SQLite database if it doesn't exist
- Applies the complete schema (tables, constraints, indexes)
- Creates the system admin user (`les.roots@etu.emse.fr`)
- Does NOT overwrite an existing database (safety)

**When to use**:

- ✅ Installation on a new machine
- ✅ First application setup
- ✅ After deleting/corrupting the database

**Important**:

- This script refuses to run if a database already exists
- To reset, first delete `data/migallery.db`

---

#### `backup-db.cjs` - Database backup

**Usage**: `npm run db:backup` or `node scripts/backup-db.cjs`

> **✨ Automatic backup**: since the current version, the server automatically triggers a daily
> backup at midnight on startup (`src/lib/server/backup.ts` → `startBackupScheduler()`). **No external
> cron is required.** The script below remains useful for occasional manual backups.

**Description**:

- Creates a copy of the database with a timestamp
- Keeps only the last 10 backups
- Automatically deletes old backups
- Displays the size of the created file

**When to use**:

- ✅ Before a major update
- ✅ Before massive data modifications
- ✅ Before testing the repair script

**Backup location**: `data/backups/`

**File format**: `migallery_backup_YYYY-MM-DD_HH-MM-SS.db`

---

#### `inspect-db.cjs` - Database inspection and repair

**Usage**:

- Inspection: `npm run db:inspect`
- Repair: `npm run db:inspect -- --repair`

**Description**:

- Checks database integrity (PRAGMA integrity_check)
- Verifies the presence of all expected tables
- Checks foreign key constraints
- Displays statistics (number of users, albums, etc.)
- Verifies the system admin user
- Can attempt to automatically repair certain errors

**When to use**:

- ✅ In case of a suspicious error in the application
- ✅ After a crash or abrupt shutdown
- ✅ To regularly check DB health
- ✅ Before a major migration

**Repair mode**:

- Recreates the system user if missing
- Fixes the system user's role
- Offers to backup and reset in case of irreparable errors

**Detected errors**:

- ❌ SQLite integrity issues
- ❌ Missing tables
- ❌ Foreign key violations
- ❌ Missing or incorrect system user

---

### 🔒 Security

#### `generate_cookie_secret.cjs` - Cryptographic secret generation

**Usage**: `npm run generate:secret` or `node scripts/generate_cookie_secret.cjs`

**Description**:

- Generates a secure cryptographic secret (32 bytes)
- Uses `crypto.randomBytes()` for true randomness
- Encodes in base64url (compatible with environment variables)

**When to use**:

- ✅ During first installation
- ✅ To periodically renew the secret (security)
- ✅ After potential compromise

**Usage example**:

```bash
# Generate and copy to .env
echo "COOKIE_SECRET=$(npm run generate:secret)" >> .env
```

**Important**:

- ⚠️ Changing the secret invalidates all user sessions
- ⚠️ Keep this secret confidential (never commit it)

---

### 📦 Packaging and deployment

#### Packaging (`npm run package`)

**Usage**: `npm run package`

**Description**:

- Creates a complete `.tgz` archive of the application
- Includes: build/, data/, .env, scripts/, README.md, package.json
- Ready for deployment on another machine
- Generates a filename with the package version

**When to use**:

- ✅ To deploy to a production server
- ✅ To create a release
- ✅ To backup the complete application state
- ✅ To migrate to a new machine

**Created file**: `build/artifacts/migallery-<version>-full.tgz`

**Prerequisites**:

- Must have run `npm run build` beforehand
- Must have configured `.env` and the database

**Deployment**:

```bash
# On the target machine
tar -xzf migallery-x.x.x-full.tgz
cd migallery
npm ci --omit=dev
# Check/adjust .env if necessary
node build/index.js
```

---

## 🔄 Recommended workflow

### Initial installation (new machine)

```bash
# 1. Clone and install
git clone https://github.com/emse-students/MiGallery.git
cd MiGallery
npm install

# 2. Configure the environment
npm run generate:secret  # Copy the output
nano .env  # Create and fill with variables

# 3. Initialize the database
npm run db:init

# 4. Automatic backup is handled by the server (startBackupScheduler).
#    It triggers at midnight on startup - nothing to configure.

# 5. Start the application
npm run dev  # Development
# or
npm run build && node build/index.js  # Production
```

### Regular maintenance

```bash
# Check DB health (monthly recommended)
npm run db:inspect

# Create a manual backup before a major operation
npm run db:backup

# Check automatic backups
ls -lh data/backups/
```

### Before a major update

```bash
# 1. Backup the database
npm run db:backup

# 2. Create a complete package (snapshot)
npm run build
npm run package

# 3. Check integrity
npm run db:inspect

# 4. Proceed with the update
git pull
npm install
npm run build
```

### In case of problems

```bash
# 1. Inspect and diagnose
npm run db:inspect

# 2. Attempt automatic repair
npm run db:inspect -- --repair

# 3. If failure: backup and reset
cp data/migallery.db data/migallery.db.corrupt
npm run db:init
# Then restore data manually or from a backup
```

---

## 📋 Environment variables used

Scripts use the following environment variables:

| Variable          | Description         | Default value         | Used by                |
| ----------------- | ------------------- | --------------------- | ---------------------- |
| `DATABASE_PATH`   | Database file path  | `./data/migallery.db` | All DB scripts         |
| `BACKUP_DIR`      | Backups folder      | `./data/backups`      | backup-db.cjs          |
| `IMMICH_BASE_URL` | Immich instance URL | -                     | init-db.cjs (optional) |
| `IMMICH_API_KEY`  | Immich API key      | -                     | init-db.cjs (optional) |

---

## 🛠️ Dependencies

Scripts require the following packages (installed automatically):

- **better-sqlite3** - SQLite interface for Node.js
- **tar** - Archive creation
- **crypto** (native) - Secret generation

---

## 📞 Support

In case of script issues:

1. Check error logs
2. Consult documentation in `README.md`
3. Check permissions (read/write on `data/`)
4. Open an issue on GitHub

---

## 🔐 Security

**Sensitive files** (NEVER COMMIT):

- `.env` - Configuration and secrets
- `data/migallery.db` - Database
- `data/backups/*.db` - Backups
- `build/artifacts/*.tgz` - Packages including .env and DB

Added to `.gitignore`:

```
.env
data/
build/
```

---

## ✅ Deployment checklist

Before deploying to production:

- [ ] Database initialized (`npm run db:init`)
- [ ] Cookie secret generated and configured in `.env`
- [ ] Immich variables configured in `.env`
- [ ] Application tested locally (`npm run dev`)
- [ ] Production build successful (`npm run build`)
- [ ] DB inspection error-free (`npm run db:inspect`)
- [ ] Complete package created (`npm run package`)
- [ ] Verify that automatic backups are being created in `data/backups/` after midnight

---

**Documentation up to date: April 2026**
