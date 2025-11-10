# MiGallery

## Vue d'ensemble

MiGallery est une application front-end basée sur SvelteKit et Vite. Bun est utilisé comme gestionnaire de paquets et runtime recommandé pour les commandes de développement et de build pour ses performances.

---

## Prérequis

- Bun (recommandé) ou Node/npm

Vérifier Bun :
```sh
bun --version
```

---

## Commandes courantes

Installer les dépendances :
```sh
bun install
```

Lancer le serveur de développement (HMR fourni par Vite) :
```sh
bun run dev
```

Build de production :
```sh
bun run build
bun run preview
```

Packaging (création d'un artefact tar.gz via le script Bun natif fourni) :
```sh
bun run package
```

---

## Arborescence détaillée et rôle des fichiers

Ci‑dessous une arborescence simplifiée, accompagnée d'explications sur le rôle de chaque élément. Les commentaires indiquent le type courant de contenu et pourquoi il est important.
```
Migallery/              — racine du projet
├─ .git/                — métadonnées Git (ne pas modifier manuellement)
├─ .env                 — variables d'environnement locales (non committées)
├─ package.json         — scripts, dépendances et métadonnées du projet
    - scripts importants :
      - dev : lance vite (serveur de dev + HMR)
      - build : compilation production
      - preview : prévisualisation de la build
      - package / package:legacy : empaquetage / fallback npm
├─ bun.lock             — lockfile créé par Bun (verrouille versions pour Bun)
├─ package-lock.json    — lockfile npm (si npm est utilisé)
├─ README.md            — documentation (ce fichier)
├─ svelte.config.js     — configuration Svelte/SvelteKit (adapteur, preprocess)
├─ tsconfig.json        — configuration TypeScript (paths, target, strictness)
├─ vite.config.ts       — configuration Vite (serveur dev, plugins, alias)
├─ build/               — sortie de la compilation (artefacts production)
├─ build/artifacts/     — artefacts packagés (ex: migallery-<version>.tgz)
├─ scripts/             — scripts utilitaires (packager, helpers)
│  └─ pack-bun.js       — script Bun natif pour empaqueter la sortie build
├─ static/              — fichiers statiques servis tels quels (robots.txt, images publiques, favicon...)
└─ src/                 — code source de l'application (SvelteKit)
   ├─ app.html          — template HTML principal injecté par SvelteKit
   ├─ hooks.server.ts   — hooks côté serveur (authentification globale, session, etc.)
   ├─ env.d.ts          — définitions/types pour import.meta.env ou variables d'environnement
   ├─ lib/              — bibliothèques utilitaires et composants réutilisables
   │  ├─ components/    — composants Svelte réutilisables (boutons, modals, cartes...)
   │  ├─ stores/        — Svelte stores (état global de l'application)
   │  ├─ auth.ts        — helpers d'authentification (exemples/abstractions)
   │  └─ immich/        — adaptateurs et helpers pour l'intégration Immich (API de gestion d'images)
   │     └─ download.ts — helper client pour demander les archives ZIP à Immich (supporte lecture en streaming et callback de progression)
   └─ routes/           — routes SvelteKit (routing basé sur fichiers)
      ├─ +layout.svelte — layout global (barre de navigation, footer, providers)
      ├─ +page.svelte   — page racine
      └─ api/           — endpoints serveur (ex: proxys, API internes)
         └─ ...         — fichiers .ts/.js exportant handlers GET/POST/PUT/DELETE
         └─ immich/     — proxy générique vers une instance Immich
            └─ [...path]/+server.ts — proxy SvelteKit qui relaie les requêtes vers la variable d'environnement IMMICH_BASE_URL et transmet la clé API (IMMICH_API_KEY)
```

---

## Packaging et distribution

Le script `package` (Bun-native) :
- exécute la build,
- crée une archive tar.gz (build/artifacts/migallery-<version>.tgz) via `scripts/pack-bun.js`.

Exemples :
```sh
bun run build
bun run package
```

---
---

Si vous voulez que je mette à jour ce fichier README.md directement dans le dépôt (création d'un commit/PR), dites‑moi et je peux préparer et pousser la modification. 
