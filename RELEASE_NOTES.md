# MiGallery v2.4.0

**Date**: September 25, 2026
**Type**: Minor Release

## 🎯 Objective

Second step of the redesign: the photo viewer answers the gestures a phone gallery owes.

## Viewer

- Swipe left or right to change photo, swipe down to close, tap to hide or show the bars, double-tap to zoom on the tapped point, pinch to zoom from 0.5x to 5x. While zoomed, one finger pans instead of changing photo. Checked on a Mi 9T.
- The two neighbouring photos are preloaded, so a swipe lands on an image that is already there (at most two extra previews per photo shown).

## Interface

- Delete moved behind a ⋮ menu in the viewer, on the album page, on photo tiles and on album cards; every delete keeps its confirmation.
- On a touch screen, the hover overlay no longer sticks on photo tiles; their actions stay in the long-press sheet.

# MiGallery v2.3.0

**Date**: September 25, 2026
**Type**: Minor Release

## 🎯 Objective

First step of the redesign towards a Google-Photos-grade gallery: flat surfaces, as the reference apps are.

## Interface

- No more glass, glow or text-shadow: buttons and panels are flat tonal surfaces (measured on the albums page: 30 blurred elements, 14 text-shadows and 1 glow down to 0). The background colour blobs stay - they are the app's identity.
- Dialogs and the photo viewer are opaque, so the page behind no longer shows through their text.
- Icons in buttons render at their intended size (the sizing rule was invalid CSS and ignored by every browser); the viewer's arrows went from a tiny glyph to 32 px.

## Developer

- `bun run dev` runs on bun (it ran vite under node, which cannot load `bun:sqlite`), and no longer logs a warning per `:global()` on start.

# MiGallery v2.2.0

**Date**: September 25, 2026
**Type**: Minor Release

## 🎯 Objective

Make the gallery fast again on a production uplink capped around 1 MB/s. The server was idle; every visitor was waiting on bytes. This release sends far fewer of them.

## Performance

- Album and person grids no longer make one Immich call per photo: a single slim, gzipped line per asset replaces ~2.5 KB of owner/EXIF/path data (an album of 479 photos went from ~800 KB to a few tens of KB).
- Grid tiles load the thumbnail only. High-density screens (phones, Retina) used to download the ~450 KB preview for every tile as well.
- The lightbox opens on the preview; the original (up to ~8 MB) now loads only when zooming in.
- The grid re-renders once per received chunk instead of once per photo.
- Album covers are now cached at the Cloudflare edge.

## Fixes

- Avatars and face crops are sent as `private`: they require a session and must never be kept by a shared cache.
- The admin panel shows the real version instead of `v1.0`.

# MiGallery v2.1.2

**Date**: September 19, 2026
**Type**: Patch Release

## Fixes

- Deleting an album now removes its Immich assets only when they are not referenced by another album.
- Shared assets and assets whose membership cannot be verified are preserved.

# MiGallery v2.1.1

**Date**: September 19, 2026
**Type**: Patch Release

## Improvements

- Avatar downloads now accept a scoped API key through the `api_key` query parameter.
- Removed all lint warnings and kept the Svelte/TypeScript checks clean.

# MiGallery v2.0.0

**Date**: August 17, 2026
**Type**: Major Release

## 🎯 Objective

Rebuild authentication on a foundation that can actually revoke a session, and make the gallery usable in two languages. Six months of work: the login stack was replaced, every user-visible string was externalized, and the album grid was rewritten around covers served from disk.

## ⚠️ Breaking Changes

Read this section before upgrading: a 1.1.0 deployment will not start unchanged.

- **Authentication moved to Authentik (MiConnect) OIDC.** EMSE CAS is gone. Three new variables are required: `MICONNECT_ISSUER`, `MICONNECT_CLIENT_ID`, `MICONNECT_CLIENT_SECRET`.
- **Auth.js was removed entirely.** `AUTH_SECRET` and `COOKIE_SECRET` are no longer read by anything - drop them. There is nothing left to sign or rotate.
- **Sessions are server-side rows.** The `migallery_session` cookie now carries a random opaque token; the row in the database is the truth. This is what makes logout and revocation real instead of advisory. **Every existing session is invalidated by the upgrade** - all users log in again.
- **Node 24 is required** (`engines: >=24.0.0`).
- **Legacy `album_*_permissions` tables were dropped** in favour of a single unified permissions table. The migration runs on startup.

## ✨ New Features and Improvements

### 🔐 Authentication and Security

- Native OIDC implementation, with the post-login destination sanitized on both write and read so a crafted return path cannot bounce a user off-site.
- A shared album link now lands on that album after login, not on the home page.
- Impersonation lives in the session row, so the real actor stays provable and a revoked session cannot outlive its logout.
- Path traversal, file-system race conditions in the image caches, and log leakage were fixed.

### 🌍 Internationalization

- Full French/English UI through Paraglide, with the choice persisted per user.
- All server-side diagnostics and code comments are English-only.

### 📸 Albums and Photos

- Album covers are rendered once and persisted on disk as square WebP, keyed by asset, instead of being resolved by the browser on every page load.
- The album grid is grouped into a school-year timeline (rollover on 15 August), and browsing state - search, unfolded years, scroll - survives a trip into an album and back.
- Accent- and typo-tolerant search across albums and the member directory.
- Uploads survive a connection loss, report live per-file status, and accept new files while one is already in flight.
- Favorites filter and long-press action sheet on mobile.

### 👤 Profiles

- Face-first profile picture picker with server-side square crops.
- Photo sharing between users, by person, formation or promotion.

### 🛠️ Administration

- Users and roles page, server health metrics, searchable and paginated logs, database maintenance, and the wiki rendered in-app.
- Scheduled database backups.

### 🎨 Interface

- Unified design tokens, theme-aware components, a global keyboard focus ring, and decluttered navigation.

## 🔧 Migration from 1.1.0

1. Register the application in Authentik and set `MICONNECT_ISSUER`, `MICONNECT_CLIENT_ID` and `MICONNECT_CLIENT_SECRET`.
2. Remove `AUTH_SECRET` and `COOKIE_SECRET` from the environment.
3. Upgrade the runtime to Node 24.
4. Back up `data/migallery.db`, then start the application - the schema migrations run automatically.
5. Warn users that they will be signed out once.

---

# MiGallery v1.1.0

**Date**: February 5, 2026
**Type**: Minor Release

## 🎯 Objective

Introduction of advanced album management features to improve flexibility without compromising data.

## ✨ New Features and Improvements

### 📸 Photo Management

- **Removal without deletion**: Ability to remove photos from a specific album without permanently deleting them from the Immich library.
- **Improved interface**: Clear contextual options added to the selection toolbar ("Remove" vs "Delete").
- **Security**: Separate confirmation modals to prevent accidental deletions.

---

# MiGallery v1.0.0

**Date**: December 22, 2025
**Type**: Stable Release

## 🎯 Objective

First official stable version of MiGallery. This version brings increased robustness, refined permission management, and full integration with the EMSE CAS.

## ✨ New Features and Improvements

### 🔒 Security and Authentication

- **EMSE CAS Integration**: Secure authentication via OIDC with `client_secret_post` support.
- **Granular Permissions**: Overhaul of the scopes system (`public`, `read`, `write`, `admin`).
- **Secure Downloads**: ZIP archive downloads are now considered a read operation (`read`), allowing more flexible yet secure access.
- **CSRF Protection**: Custom origin verification implementation for API mutations.

### 📸 Media Management

- **Optimized Immich Proxy**: Better data flow management and API path resolution.
- **Reliable ZIP Download**: New robust implementation for downloading complete albums, compatible with all modern browsers.
- **Public Album Support**: Simplified access to unlisted albums via secure links.

### 🛠️ Administration and Maintenance

- **Audit Logs**: New logging system to track logins, API key usage, and asset modifications.
- **Automatic Cleanup**: Maintenance scripts to purge temporary files and optimize disk space.
- **API Documentation**: Updated interactive documentation and complete permission audit.

### 🚀 Performance and DevOps

- **Bun Optimization**: Intensive use of Bun capabilities for maximum performance.
- **Robust CI/CD**: Improved GitHub Actions workflow for frictionless deployments.
- **Zero Technical Debt**: Complete cleanup of obsolete scripts and fix of all linting warnings.

---

# MiGallery v0.1.0-alpha.1

**Date**: November 21, 2025
**Type**: Pre-release (Alpha)

## 🎯 Objective

First public alpha version of MiGallery for functional testing and user feedback. This version contains all core features and a complete CI/CD system.

## ✨ Core Features

### Core Features

- 📸 Modern photo gallery with Svelte 5 interface
- 👤 Facial recognition via Immich integration
- 📁 Custom and shared album management
- 🎓 Directory system for organizations
- 🔐 SSO Authentication (Authelia/Authentik)
- 🗑️ Trash with restore

### API & Security

- ✅ Complete REST API with API keys and scopes (read/write/delete/admin)
- ✅ Protection of all external endpoints
- ✅ Interactive API documentation (Swagger-like)
- ✅ Unit tests with Vitest (18+ tests)

### DevOps & Quality

- ✅ CI/CD GitHub Actions (lint, check, build, test, package, deploy)
- ✅ Pre-commit hooks with ESLint + TypeScript
- ✅ Automatic packaging (.tgz with build + data + .env)
- ✅ 0 TypeScript errors in strict mode
- ✅ ESLint v9 with modern flat configuration

## 📦 Package Contents

- `build/` - Compiled application ready for production
- `data/` - SQLite database (if present)
- `.env` - Configuration (adjust for your environment)
- `package.json` - Metadata and dependencies
- `README.md` - Complete documentation
- `scripts/` - Administration scripts (init-db, backup, etc.)

## 🚀 Quick Installation

```bash
# Extract the archive
tar -xzf migallery-0.1.0-alpha.1-full.tgz
cd migallery

# Install dependencies
npm ci --omit=dev

# Configure .env (edit according to your environment)
# Adjust IMMICH_URL, IMMICH_API_KEY, AUTH_SECRET, COOKIE_SECRET

# Initialize the database (if needed)
npm run db:init

# Start the application
bun build/index.js
```

Access at http://localhost:3000

## 📚 Documentation

- **Main README**: Complete installation and configuration instructions
- **Tutorial**: `docs/tutorials/tutorial.md` - Step-by-step user guide
- **API Security**: `docs/API_SECURITY.md` - API keys and scopes documentation
- **CI/CD Workflows**: `.github/workflows/` - Automated pipelines

## ⚠️ Known Limitations (Alpha)

- Tutorial incomplete (being rewritten)
- Debugging video not provided (coming soon)
- Test coverage to be improved (currently ~70%)
- Some non-blocking ESLint warnings remaining

## 🔄 Full Changelog

### Features

- Complete Immich integration with API proxy
- Granular permission system per album
- NDJSON streaming for optimized photo loading
- Smart client cache for increased performance
- Complete admin interface (users, API keys, database)

### Fixes

- ✅ Fixed 208 TypeScript errors
- ✅ Consolidated API types (`src/lib/types/api.ts`)
- ✅ Secured all external endpoints
- ✅ Restored CI workflow after corruption

### Chore

- Updated pre-commit hooks (lint + check)
- Merged DevOps documentation into README
- Created automatic packaging script
- ESLint v9 flat config configuration

## 🐛 Known Bugs

No blocking bugs identified. To report an issue:
https://github.com/DeMASKe/MiGallery/issues

## 📋 Next Steps (v0.1.0-beta.1)

- [ ] Complete tutorial rewrite with screenshots
- [ ] Debugging demonstration video (3 min)
- [ ] E2E tests with Playwright
- [ ] Increase test coverage to 85%+
- [ ] Auto-generated TypeDoc documentation
- [ ] Multi-language support (i18n)

## 🙏 Contributors

- **DeMASKe** - Lead development
- **MiTV Team** - Testing and feedback

## 📄 License

GNU General Public License v3.0 (GPL-3.0)
See `LICENSE` for more details.

---

**Note**: This is an alpha pre-release intended for testing. Do not use in production without thorough testing.
