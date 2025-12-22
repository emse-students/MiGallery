# Scripts MiGallery

Ce dossier contient les scripts utilitaires pour le développement, la maintenance et le déploiement de MiGallery.

## Maintenance & Production

| Script                       | Description                                                               | Usage                                     |
| :--------------------------- | :------------------------------------------------------------------------ | :---------------------------------------- |
| `init-db.cjs`                | Initialise la base de données SQLite (création des tables et de l'admin). | `bun run db:init`                         |
| `migrate-db.cjs`             | Applique les migrations SQL pour mettre à jour le schéma de la DB.        | `bun run db:migrate`                      |
| `backup-db.cjs`              | Crée une sauvegarde à chaud de la base de données.                        | `bun run db:backup`                       |
| `cleanup-chunked-temp.js`    | Nettoie les fichiers d'upload temporaires orphelins.                      | `bun run cleanup:chunked-temp`            |
| `generate-auth-secret.cjs`   | Génère une clé `AUTH_SECRET` pour la configuration.                       | `node scripts/generate-auth-secret.cjs`   |
| `generate_cookie_secret.cjs` | Génère une clé `COOKIE_SECRET` pour la session.                           | `node scripts/generate_cookie_secret.cjs` |

## Développement & Tests

| Script                 | Description                                                               | Usage                             |
| :--------------------- | :------------------------------------------------------------------------ | :-------------------------------- |
| `run-tests.mjs`        | Lance la suite complète de tests (unitaires et intégration).              | `bun test`                        |
| `mock-immich.js`       | Simule un serveur Immich local pour tester les uploads sans serveur réel. | `node scripts/mock-immich.js`     |
| `test-with-server.mjs` | Lance les tests en démarrant automatiquement un serveur temporaire.       | `npm test`                        |
| `create-api-key.cjs`   | Utilitaire pour générer une clé API avec des scopes spécifiques.          | `node scripts/create-api-key.cjs` |
| `inspect-db.cjs`       | Outil de debug pour visualiser rapidement le contenu des tables.          | `bun run db:inspect`              |

## Déploiement & CI

| Script                 | Description                                                      | Usage                               |
| :--------------------- | :--------------------------------------------------------------- | :---------------------------------- |
| `wait-for-server.mjs`  | Attend que l'URL du serveur réponde (utilisé dans `deploy.yml`). | Interne CI                          |
| `pack-bun.js`          | Prépare un package `.tgz` prêt à être déployé.                   | `bun run package`                   |
| `auto-document-api.js` | Met à jour la documentation des endpoints API.                   | `node scripts/auto-document-api.js` |
