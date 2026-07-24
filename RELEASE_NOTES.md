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
node build/index.js
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
