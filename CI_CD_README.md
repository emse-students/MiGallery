# 🚀 CI/CD Quick Reference

## ✅ Ce qui a été fait

### 1. Matrice de versions (1/5) ✅

- Tests sur **Node.js 18, 20, 22**
- Build + Lint + Tests sur chaque commit
- Workflow: `.github/workflows/ci-bun.yml`

### 2. Analyse de code (1/5) ✅

- **CodeQL** : sécurité + vulnérabilités
- **TruffleHog** : détection de secrets
- **ESLint** : qualité de code
- **SonarCloud** : dette technique (optionnel)
- Workflow: `.github/workflows/code-analysis.yml`

### 3. Release automatique (2/5) ✅

- Déclenché par création de tag (`v*.*.*`)
- Changelog auto-généré depuis dernier tag
- Artifacts (.tgz) attachés à la release
- Workflow: `.github/workflows/release.yml`

### 4. Documentation GitHub Pages (1/5) ✅

- Publication auto sur branche `main`
- Conversion Markdown → HTML
- URL: `https://emse-students.github.io/MiGallery/`
- Workflow: `.github/workflows/docs.yml`

---

## 🎯 Score : **5/5 points**

---

## 💡 Usage rapide

### Créer une release

```bash
git tag v1.0.0
git push origin v1.0.0
```

### Voir les résultats

- **CI/CD**: [Actions](https://github.com/emse-students/MiGallery/actions)
- **Releases**: [Releases](https://github.com/emse-students/MiGallery/releases)
- **Docs**: [Pages](https://emse-students.github.io/MiGallery/)

---

## 📖 Documentation complète

Voir [`docs/CI_CD_SETUP.md`](CI_CD_SETUP.md) pour tous les détails.
