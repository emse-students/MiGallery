# ⚙️ Configuration Post-Installation

## Actions requises pour activer toutes les fonctionnalités

### 1. ✅ Activer GitHub Pages (OBLIGATOIRE pour 1/5 point)

1. Aller sur : <https://github.com/emse-students/MiGallery/settings/pages>
2. Dans **Build and deployment** :
   - Source : sélectionner **GitHub Actions**
3. Cliquer sur **Save**
4. La documentation sera publiée automatiquement à la prochaine modification de fichier dans `docs/` ou `main`

**URL après activation :** <https://emse-students.github.io/MiGallery/>

---

### 2. 🔒 Activer CodeQL (Déjà configuré, optionnel)

CodeQL fonctionnera automatiquement sans configuration supplémentaire.

Pour voir les résultats :

- Aller sur : <https://github.com/emse-students/MiGallery/security/code-scanning>

---

### 3. 📊 Configurer SonarCloud (OPTIONNEL, mais recommandé)

SonarCloud nécessite un compte gratuit :

1. **Créer un compte** sur <https://sonarcloud.io> avec votre compte GitHub
2. **Importer le projet** `emse-students/MiGallery`
3. **Copier le token** généré par SonarCloud
4. **Ajouter le secret dans GitHub** :
   - Aller sur : <https://github.com/emse-students/MiGallery/settings/secrets/actions>
   - Cliquer sur **New repository secret**
   - Name : `SONAR_TOKEN`
   - Value : [coller le token de SonarCloud]
   - Cliquer sur **Add secret**

Le workflow `code-analysis.yml` utilisera automatiquement ce token.

---

### 4. 🧪 Tester la configuration

#### Test 1 : CI avec matrice de versions

```bash
git add .
git commit -m "test: vérifier CI multi-versions"
git push
```

Vérifier sur : <https://github.com/emse-students/MiGallery/actions>

Vous devriez voir 3 jobs parallèles (Node 18, 20, 22).

#### Test 2 : Analyse de code

Le workflow `code-analysis.yml` se déclenche automatiquement avec le push ci-dessus.

Vérifier les résultats :

- CodeQL : <https://github.com/emse-students/MiGallery/security/code-scanning>
- Workflow : <https://github.com/emse-students/MiGallery/actions/workflows/code-analysis.yml>

#### Test 3 : Release automatique

```bash
git tag v1.0.0
git push origin v1.0.0
```

Attendre 5-10 minutes, puis vérifier :
<https://github.com/emse-students/MiGallery/releases>

Vous devriez voir :

- ✅ Release `v1.0.0`
- ✅ Changelog automatique
- ✅ Fichier `.tgz` attaché

#### Test 4 : Documentation GitHub Pages

```bash
# Modifier un fichier de documentation
echo "# Test" >> docs/TEST.md
git add docs/TEST.md
git commit -m "docs: test publication GitHub Pages"
git push
```

Après ~2 minutes, vérifier :
<https://emse-students.github.io/MiGallery/>

---

## ✅ Checklist de vérification

- [ ] GitHub Pages activé (Settings → Pages → Source: GitHub Actions)
- [ ] CI fonctionne sur 3 versions de Node.js
- [ ] CodeQL activé (Security → Code scanning)
- [ ] TruffleHog scanne les secrets
- [ ] Release créée avec tag `v1.0.0`
- [ ] Documentation publiée sur Pages
- [ ] (Optionnel) SonarCloud configuré

---

## 🎯 Résultat attendu

Après configuration complète, vous aurez :

| Fonctionnalité                      | Points  | Status                         |
| ----------------------------------- | ------- | ------------------------------ |
| Matrice de versions (Node 18/20/22) | 1/5     | ✅                             |
| Analyse de code (4 types)           | 1/5     | ✅                             |
| Release + Changelog automatique     | 2/5     | ✅                             |
| Documentation GitHub Pages          | 1/5     | ✅ (après activation manuelle) |
| **TOTAL**                           | **5/5** | ✅                             |

---

## 🆘 Besoin d'aide ?

- Problèmes avec les workflows : Vérifier l'onglet **Actions**
- Erreurs de configuration : Lire les logs détaillés dans chaque job
- Questions : Consulter [`docs/CI_CD_SETUP.md`](docs/CI_CD_SETUP.md)

---

**Note :** La seule action manuelle obligatoire est l'activation de GitHub Pages. Tout le reste fonctionne automatiquement dès le prochain push !
