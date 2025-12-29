# 🎯 Configuration CI/CD - MiGallery

## ✅ Résumé des tâches accomplies

### 1️⃣ Matrice de versions (1/5 points) ✅

**Workflow:** [`.github/workflows/ci-bun.yml`](.github/workflows/ci-bun.yml)

Le workflow CI teste maintenant le projet sur **3 versions de Node.js** :

- Node.js 18 (LTS)
- Node.js 20 (LTS actuel)
- Node.js 22 (Latest)

```yaml
strategy:
 matrix:
  node-version: [18, 20, 22]
```

Sur chaque commit/PR, le projet est :

- ✅ Compilé avec TypeScript
- ✅ Vérifié avec ESLint
- ✅ Testé avec la suite de tests complète
- ✅ Packagé (sur la branche `main` uniquement)

---

### 2️⃣ Analyse de code (1/5 points) ✅

**Workflow:** [`.github/workflows/code-analysis.yml`](.github/workflows/code-analysis.yml)

Quatre types d'analyses automatisées :

#### 🔍 CodeQL (GitHub Security)

- Analyse statique de sécurité
- Détection de vulnérabilités (XSS, injection, etc.)
- Analyse quotidienne automatique à 2h du matin
- Langages : JavaScript + TypeScript

#### 🔐 TruffleHog (Scan de secrets)

- Détecte les secrets (tokens, clés API, mots de passe)
- Scanne chaque commit
- Bloque si des secrets sont trouvés

#### 📊 ESLint Security

- Analyse des problèmes de qualité de code
- Détection des code smells
- Vérification du style de code

#### 🎯 SonarCloud (Optionnel)

- Analyse approfondie de la qualité du code
- Mesure de la dette technique
- Couverture de tests
- **Nécessite configuration:** voir section ci-dessous

---

### 3️⃣ Release automatique (2/5 points) ✅

**Workflow:** [`.github/workflows/release.yml`](.github/workflows/release.yml)

#### Déclenchement

Créer un tag avec la commande :

```bash
git tag v1.0.0
git push origin v1.0.0
```

#### Processus automatique

1. **Tests complets** sur les 3 versions de Node.js
2. **Build de production**
3. **Packaging** de l'application
4. **Génération automatique du changelog** depuis le dernier tag
5. **Création de la release GitHub** avec :
   - 📝 Notes de version auto-générées
   - 📦 Artifacts (.tgz)
   - 🔗 Lien vers le diff complet
   - 📋 Instructions d'installation

#### Exemple de changelog généré

```markdown
## 🚀 What's Changed

- feat: Add user authentication (a1b2c3d)
- fix: Resolve album loading issue (e4f5g6h)
- docs: Update API documentation (i7j8k9l)

## 📦 Installation

[Instructions automatiques]

**Full Changelog**: https://github.com/emse-students/MiGallery/compare/v0.9.0...v1.0.0
```

---

### 4️⃣ Publication de documentation (1/5 points) ✅

**Workflow:** [`.github/workflows/docs.yml`](.github/workflows/docs.yml)

#### Configuration requise (une seule fois)

1. Aller dans **Settings** → **Pages**
2. Source: **GitHub Actions**

#### Fonctionnement

- Se déclenche automatiquement sur la branche `main` quand :
  - Un fichier dans `docs/` est modifié
  - Un fichier dans `src/lib/docs/` est modifié
  - Le `README.md` est modifié

#### Génération

1. Convertit tous les `.md` en HTML
2. Crée une page d'accueil élégante
3. Publie sur GitHub Pages

#### URL de la documentation

```text
https://emse-students.github.io/MiGallery/
```

---

## 🚀 Comment utiliser

### Développement normal

Rien ne change ! Les workflows se déclenchent automatiquement :

- Sur chaque `git push` → CI + Analyse
- Sur chaque Pull Request → CI + Analyse

### Créer une release

```bash
# 1. Vérifier que tout est commité
git status

# 2. Créer et pousser le tag
git tag v1.2.3
git push origin v1.2.3

# 3. Attendre quelques minutes
# ➡️ La release sera créée automatiquement sur GitHub
```

### Vérifier les résultats

- **CI/CD:** <https://github.com/emse-students/MiGallery/actions>
- **Releases:** <https://github.com/emse-students/MiGallery/releases>
- **Documentation:** <https://emse-students.github.io/MiGallery/>
- **Security:** <https://github.com/emse-students/MiGallery/security>

---

## ⚙️ Configuration optionnelle

### SonarCloud (recommandé)

1. Créer un compte sur <https://sonarcloud.io>
2. Importer le projet `emse-students/MiGallery`
3. Copier le token généré
4. Dans GitHub: **Settings** → **Secrets** → **Actions**
5. Ajouter `SONAR_TOKEN` avec la valeur du token

### Notifications

Ajouter dans chaque workflow (optionnel) :

```yaml
- name: Notify on failure
  if: failure()
  uses: actions/github-script@v7
  with:
   script: |
    github.rest.issues.create({
      owner: context.repo.owner,
      repo: context.repo.repo,
      title: 'CI Failed on ${{ github.ref }}',
      body: 'Workflow failed. Check the logs.'
    })
```

---

## 📊 Récapitulatif des points

| Critère                                     | Points  | Status |
| ------------------------------------------- | ------- | ------ |
| Matrice de versions (Node.js 18/20/22)      | 1/5     | ✅     |
| Analyse de code (CodeQL + Secrets + ESLint) | 1/5     | ✅     |
| Release auto + Changelog                    | 2/5     | ✅     |
| Documentation GitHub Pages                  | 1/5     | ✅     |
| **TOTAL**                                   | **5/5** | **✅** |

---

## 🎓 Bonus implémentés

- ✨ Tests sur 3 versions de Node.js au lieu de 2
- 🔒 4 types d'analyses de code au lieu d'une seule
- 📦 Artifacts conservés 90 jours
- 🎨 Documentation web stylée et responsive
- 📝 Changelog automatique intelligent
- 🔄 Gestion des pre-releases (alpha, beta, rc)

---

## 📝 Fichiers créés/modifiés

1. [`.github/workflows/ci-bun.yml`](.github/workflows/ci-bun.yml) - ✏️ Modifié (ajout matrice)
2. [`.github/workflows/code-analysis.yml`](.github/workflows/code-analysis.yml) - ✨ Nouveau
3. [`.github/workflows/release.yml`](.github/workflows/release.yml) - ✨ Nouveau
4. [`.github/workflows/docs.yml`](.github/workflows/docs.yml) - ✨ Nouveau
5. [`sonar-project.properties`](sonar-project.properties) - ✨ Nouveau

---

## 🆘 Dépannage

### Les tests échouent ?

```bash
# Tester localement
bun run test
```

### La release ne se crée pas ?

- Vérifier que les tests passent
- Le tag doit être au format `v*.*.*` (ex: `v1.0.0`)

### La documentation ne se publie pas ?

- Activer GitHub Pages dans les settings
- Vérifier que le workflow `docs.yml` s'est exécuté

### CodeQL échoue ?

- Normal la première fois, peut prendre 10-15 minutes
- Si persiste, vérifier les logs dans l'onglet Actions

---

## 📚 Ressources

- [Documentation GitHub Actions](https://docs.github.com/actions)
- [CodeQL Documentation](https://codeql.github.com/docs/)
- [SonarCloud Setup](https://docs.sonarcloud.io/)
- [Semantic Versioning](https://semver.org/)

---

**🎉 Félicitations ! Votre projet dispose maintenant d'une CI/CD complète et professionnelle !**
