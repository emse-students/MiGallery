# MiGallery v0.1.0-alpha.1

**Date**: 21 novembre 2025
**Type**: Pré-release (Alpha)

## 🎯 Objectif

Première version alpha publique de MiGallery pour tests fonctionnels et retours utilisateurs. Cette version contient toutes les fonctionnalités principales et un système de CI/CD complet.

## ✨ Fonctionnalités principales

### Core Features
- 📸 Galerie photo moderne avec interface Svelte 5
- 👤 Reconnaissance faciale via intégration Immich
- 📁 Gestion d'albums personnalisés et partagés
- 🎓 Système de trombinoscope pour organisations
- 🔐 Authentification SSO (Authelia/Authentik)
- 🗑️ Corbeille avec restauration

### API & Sécurité
- ✅ API REST complète avec clés d'API et scopes (read/write/delete/admin)
- ✅ Protection de tous les endpoints externes
- ✅ Documentation API interactive (Swagger-like)
- ✅ Tests unitaires avec Vitest (18+ tests)

### DevOps & Qualité
- ✅ CI/CD GitHub Actions (lint, check, build, test, package, deploy)
- ✅ Pre-commit hooks avec ESLint + TypeScript
- ✅ Packaging automatique (.tgz avec build + data + .env)
- ✅ 0 erreurs TypeScript strict mode
- ✅ ESLint v9 avec configuration flat moderne

## 📦 Contenu du package

- `build/` - Application compilée prête pour production
- `data/` - Base de données SQLite (si présente)
- `.env` - Configuration (à adapter pour votre environnement)
- `package.json` - Métadonnées et dépendances
- `README.md` - Documentation complète
- `scripts/` - Scripts d'administration (init-db, backup, etc.)

## 🚀 Installation rapide

```bash
# Extraire l'archive
tar -xzf migallery-0.1.0-alpha.1-full.tgz
cd migallery

# Installer les dépendances
bun install --production

# Configurer .env (éditer selon votre environnement)
# Ajuster IMMICH_URL, IMMICH_API_KEY, AUTH_SECRET, COOKIE_SECRET

# Initialiser la base de données (si besoin)
bun run db:init

# Lancer l'application
bun run build/index.js
```

Accédez à http://localhost:3000

## 📚 Documentation

- **README principal**: Instructions complètes d'installation et configuration
- **Tutorial**: `docs/tutorials/tutorial.md` - Guide d'utilisation pas-à-pas
- **API Security**: `docs/API_SECURITY.md` - Documentation des clés API et scopes
- **Workflows CI/CD**: `.github/workflows/` - Pipelines automatisés

## ⚠️ Limitations connues (Alpha)

- Tutorial incomplet (en cours de réécriture)
- Vidéo de debugging non fournie (à venir)
- Couverture de tests à améliorer (actuellement ~70%)
- Certains warnings ESLint non-bloquants restants

## 🔄 Changelog complet

### Features
- Intégration complète Immich avec proxy API
- Système de permissions granulaires par album
- Streaming NDJSON pour chargement optimisé des photos
- Cache client intelligent pour performances accrues
- Interface admin complète (utilisateurs, API keys, base de données)

### Fixes
- ✅ Correction de 208 erreurs TypeScript
- ✅ Consolidation des types API (`src/lib/types/api.ts`)
- ✅ Sécurisation de tous les endpoints externes
- ✅ Restauration du workflow CI après corruption

### Chore
- Mise à jour des hooks pre-commit (lint + check)
- Merge de la documentation DevOps dans le README
- Création du script de packaging automatique
- Configuration ESLint v9 flat config

## 🐛 Bugs connus

Aucun bug bloquant identifié. Pour signaler un problème :
https://github.com/DeMASKe/MiGallery/issues

## 📋 Prochaines étapes (v0.1.0-beta.1)

- [ ] Réécriture complète du tutorial avec captures d'écran
- [ ] Vidéo de démonstration du debugging (3 min)
- [ ] Tests E2E avec Playwright
- [ ] Augmentation couverture de tests à 85%+
- [ ] Documentation TypeDoc générée automatiquement
- [ ] Support multi-langues (i18n)

## 🙏 Contributeurs

- **DeMASKe** - Développement principal
- **Équipe MiTV** - Tests et retours

## 📄 License

GNU General Public License v3.0 (GPL-3.0)
Voir `LICENSE` pour plus de détails.

---

**Note**: Ceci est une pré-release alpha destinée aux tests. Ne pas utiliser en production sans tests approfondis.
