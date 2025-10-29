# sv

Everything you need to build a Svelte project, powered by [`sv`](https://github.com/sveltejs/cli).

## Creating a project

If you're seeing this, you've probably already done this step. Congrats!

```sh
# create a new project in the current directory
# MiGallery — Utilisation avec Bun (préféré)

Ce README se concentre sur l'utilisation de Bun comme gestionnaire et runtime pour le développement et la build de ce projet. Bun est recommandé pour ce projet parce qu'il est rapide pour l'installation et l'exécution des scripts.

Important : la recompilation "à chaud" (rebuild / hot reload) pendant le développement est fournie par Vite (HMR). Quand tu lances `bun run dev`, Bun exécute le script `dev` défini dans `package.json` qui lance `vite dev` — c'est Vite qui fait le rechargement à chaud, Bun exécute simplement le processus plus rapidement.

## Pourquoi utiliser Bun ici ?

- Installation très rapide (`bun install`) comparée à npm/pnpm dans de nombreux cas.
- Exécution rapide des scripts (`bun run ...`).
- Intégration simple : Bun exécute les scripts définis dans `package.json` comme npm.

## Fichiers importants

- `package.json` : contient les scripts (`dev`, `build`, `test`, `package`) et les métadonnées.
- `bun.lock` : lockfile produit par Bun — garde la reproductibilité des dépendances pour Bun.
- `vite.config.ts` : configuration Vite/SvelteKit — c'est Vite qui gère HMR et la compilation.

## Arborescence du projet

Voici une arborescence simplifiée des fichiers et dossiers principaux avec leur rôle (description générale) :

```
Migallery/
├─ .git/                     # Référentiel Git
├─ .env                      # Variables d'environnement (local)
├─ package.json              # Scripts, dépendances et métadonnées du projet
├─ bun.lock                  # Lockfile créé par Bun (reproductibilité)
├─ package-lock.json         # Lockfile npm (si npm est utilisé)
├─ README.md                 # Documentation (ce fichier)
├─ svelte.config.js          # Configuration SvelteKit
├─ tsconfig.json             # Configuration TypeScript
├─ vite.config.ts            # Configuration Vite (dev server, build)
├─ build/                    # Artefacts de build (sortie production)
├─ scripts/                  # Scripts utilitaires (packager, helpers)
├─ static/                   # Fichiers statiques servis tels quels (robots.txt, images...)
├─ src/                      # Code source de l'application
│  ├─ app.html               # Template HTML utilisé par SvelteKit
│  ├─ hooks.server.ts        # Hooks côté serveur (auth, etc.)
│  ├─ env.d.ts               # Types d'environnement / import meta
│  ├─ lib/                   # Bibliothèques utilitaires et composants réutilisables
│  │  └─ auth.ts             # Helpers d'authentification (exemples)
│  └─ routes/                # Pages et routes SvelteKit (routes basées sur fichiers)
│     ├─ +layout.svelte
│     ├─ +page.svelte
│     └─ api/                # Endpoints serveur (ex: immich proxy)
└─ .github/                  # CI / workflows (GitHub Actions)
	└─ workflows/ci-bun.yml   # Pipeline CI utilisant Bun (install, build, package)

```

Notes :
- Les fichiers de tests ont été retirés de ce dépôt. Si tu veux que je les réinstalle plus tard, je peux ajouter une section `tests/` ou `src/__tests__/` avec Vitest et exemples.
- Les lockfiles (`bun.lock` / `package-lock.json`) peuvent coexister si différentes personnes utilisent Bun/npm ; choisis un gestionnaire principal pour l'équipe.

## Commandes recommandées (PowerShell)

Installer les dépendances (Bun)

```pwsh
bun install
```

Lancer le serveur de développement (avec rechargement à chaud géré par Vite)

```pwsh
bun run dev
```

Remarque : `bun run dev` exécute `vite dev` (script `dev` dans `package.json`). Vite surveille les fichiers et applique HMR (Hot Module Replacement) à la volée — tu verras les changements dans le navigateur sans recharger manuellement.

Build production

```pwsh
bun run build
## MiGallery — guide détaillé pour débutants (Bun + Vite + SvelteKit)

Ce document présente pas à pas comment configurer, développer, build-er et packager ce projet en utilisant Bun comme gestionnaire de paquets et runtime. Il est écrit pour un public débutant : chaque commande est expliquée et accompagnée de conseils de dépannage.

### 1) Concepts rapides

- Bun : un runtime JavaScript + gestionnaire de paquets rapide (comme Node + npm, mais plus rapide dans de nombreux scénarios).
- Vite : l'outil de build/dev server utilisé par SvelteKit. Vite fournit le Hot Module Replacement (HMR) — c'est lui qui recharge le navigateur quand tu changes le code.
- SvelteKit : framework applicatif basé sur Svelte, utilisé par ce projet.
- Lockfiles : `bun.lock` (pour Bun) et `package-lock.json` (pour npm) verrouillent les versions des dépendances pour la reproductibilité.

### 2) Prérequis (Windows)

- Git (optionnel mais recommandé)
- PowerShell (tu as déjà pwsh)
- Bun installé et sur le PATH. Pour installer Bun sur Windows, suis les instructions officielles : https://bun.sh/docs/installation

Vérifier Bun :

```pwsh
bun --version
```

Si tu préfères utiliser npm, tout fonctionne aussi avec `npm install` et `npm run ...` — le README se concentre sur Bun mais j'indique les commandes npm quand utile.

### 3) Installer les dépendances

Avec Bun (recommandé pour ce projet) :

```pwsh
bun install
```

Explication : Bun lit `package.json` et installe les dépendances, en créant/updatant `bun.lock`.

Alternative npm :

```pwsh
npm install
# ou, pour une installation reproductible en CI
npm ci
```

### 4) Lancer le serveur de développement (HMR)

```pwsh
bun run dev
```

Que se passe-t-il ?
- Bun lance le script `dev` défini dans `package.json` (ici `vite dev`).
- Vite démarre un serveur de développement et active HMR — lorsque tu modifies un fichier source, le navigateur est mis à jour automatiquement sans rechargement complet.

Conseil : ouvre la console où tu as lancé `bun run dev` pour voir les logs et erreurs.

### 5) Build production

```pwsh
bun run build
```

Cette commande lance la compilation optimisée (minification, bundling) préparant les fichiers pour la production. Les artefacts se trouvent ensuite dans `build/`.

Prévisualiser la build :

```pwsh
bun run preview
```


### 6) Packaging (création d'un artefact) — Bun-native

Le projet fournit maintenant un packaging 100% Bun-native. Le script `package` exécute d'abord la build puis lance `scripts/pack-bun.js` avec Bun pour créer un `.tgz` contenant le contenu de `build/`.

Exécuter (Bun) :

```pwsh
bun run package
```

Si Bun n'est pas disponible, un script de secours `package:legacy` existe et utilise `npm pack` :

```pwsh
npm run package:legacy
```

Résultat : `build/artifacts/migallery-<version>.tgz` — archive prête à être distribuée. Le script Bun (`scripts/pack-bun.js`) utilise le package `tar` pour créer un tar.gz de `build/`.

### 7) Tests

Les tests ont été retirés de ce dépôt. Si tu souhaites réintroduire une suite de tests plus tard, je peux t'aider à la remettre en place proprement (Vitest + @testing-library/svelte ou autre).

### 8) Gestion des versions

Utilise les commandes npm classiques (elles agissent sur `package.json`) :

```pwsh
npm version patch   # incrémente la version patch
npm version minor
npm version major
```

Ces commandes mettent à jour `package.json` et, si tu as Git propre, créent un commit et un tag correspondant.

### 9) Intégration continue (CI)

Un workflow GitHub Actions est inclus : `.github/workflows/ci-bun.yml`.
Ce pipeline :

- installe Bun
- exécute `bun install`
- exécute `bun run build`
- exécute les tests seulement s'il y en a
- exécute `bun run package` (ou `npm run package` en fallback)
- téléverse le `.tgz` comme artefact

Pour reproduire localement les étapes de la CI :

```pwsh
bun install
bun run build
bun run package
```

### 10) Dépannage fréquent (Windows)

- Erreur EPERM / fichiers verrouillés pendant `npm ci` ou `bun install` :
	- Ferme VS Code / l'éditeur qui pourrait garder un handle ouvert.
	- Désactive temporairement l'antivirus si nécessaire.
	- Supprime `node_modules` et relance l'installation :

```pwsh
Remove-Item -LiteralPath .\node_modules -Recurse -Force -ErrorAction SilentlyContinue
bun install
```

- Long path / permission : exécute PowerShell en tant qu'administrateur si nécessaire.
- Si un paquet natif échoue sous Bun, tente `npm install` pour voir si l'erreur est spécifique à Bun.

### 11) FAQ rapide

- Q : "Bun remplace Node ?" — Non, Bun est un runtime alternatif compatible avec la plupart des projets JS/TS. Tu peux continuer à utiliser Node/npm si nécessaire.
- Q : "Pourquoi j'ai deux lockfiles ?" — `bun.lock` est créé par Bun. Si tu utilises npm en plus, `package-lock.json` sera généré et les deux peuvent diverger. Choisis un gestionnaire principal pour l'équipe.
- Q : "Comment garantir la reproductibilité en CI ?" — Utilise le même gestionnaire en local et en CI (ici : Bun). Commit `bun.lock` pour que Bun reproduise exactement les mêmes versions.

### 12) Contrat minimal (inputs/outputs)

- Inputs : code source dans `src/`, dépendances listées dans `package.json`.
- Outputs : production build dans `build/`, artefact `build/artifacts/migallery-<version>.tgz` après `npm pack`.
- Mode d'échec : erreurs de compilation (affichées par Vite), erreurs d'installation (permissions, dépendances natives).

### 13) Cas limites & conseils

- Aucun test : la CI ne cassera pas ; mais ajoute un test minimal pour vérifier la pipeline.
- Dépendances natives / binaires : peuvent nécessiter `npm` ou compilation native sur certaines plateformes. Tester sur la cible CI OS.
- Conflits de lockfile : si des collègues utilisent npm/pnpm, ajoute une section dans le CONTRIBUTING.md pour préciser le gestionnaire recommandé.

---

Si tu veux que je réintroduise une solution de tests ou que j'ajoute un packaging alternatif (ZIP), dis‑le et je m'en charge.
