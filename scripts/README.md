# Scripts MiGallery

Ce dossier contient les scripts utilitaires pour le développement, la maintenance et le déploiement de MiGallery.

## Maintenance & Production

| Script                       | Description                                                                                                 | Usage                                     |
| :--------------------------- | :---------------------------------------------------------------------------------------------------------- | :---------------------------------------- |
| `init-db.cjs`                | Initialise la base de données SQLite (création des tables et de l'admin).                                   | `npm run db:init`                         |
| `backup-db.cjs`              | Sauvegarde manuelle de la base de données (la sauvegarde automatique quotidienne est gérée par le serveur). | `npm run db:backup`                       |
| `cleanup-chunked-temp.js`    | Nettoie les fichiers d'upload temporaires orphelins.                                                        | `npm run cleanup:chunked-temp`            |
| `generate-auth-secret.cjs`   | Génère une clé `AUTH_SECRET` pour la configuration.                                                         | `node scripts/generate-auth-secret.cjs`   |
| `generate_cookie_secret.cjs` | Génère une clé `COOKIE_SECRET` pour la session.                                                             | `node scripts/generate_cookie_secret.cjs` |

## Développement & Tests

| Script                 | Description                                                               | Usage                             |
| :--------------------- | :------------------------------------------------------------------------ | :-------------------------------- |
| `run-tests.mjs`        | Lance la suite complète de tests (unitaires et intégration).              | `npm run test`                    |
| `mock-immich.js`       | Simule un serveur Immich local pour tester les uploads sans serveur réel. | `node scripts/mock-immich.js`     |
| `test-with-server.mjs` | Lance les tests en démarrant automatiquement un serveur temporaire.       | `npm test`                        |
| `create-api-key.cjs`   | Utilitaire pour générer une clé API avec des scopes spécifiques.          | `node scripts/create-api-key.cjs` |
| `inspect-db.cjs`       | Outil de debug pour visualiser rapidement le contenu des tables.          | `npm run db:inspect`              |

## Déploiement & CI

| Script                | Description                                                      | Usage             |
| :-------------------- | :--------------------------------------------------------------- | :---------------- |
| `wait-for-server.mjs` | Attend que l'URL du serveur réponde (utilisé dans `deploy.yml`). | Interne CI        |
| `npm run package`     | Prépare un package `.tgz` prêt à être déployé.                   | `npm run package` |

## Migration (usage unique)

| Script                          | Description                                                                               | Usage                                                        |
| :------------------------------ | :---------------------------------------------------------------------------------------- | :----------------------------------------------------------- |
| `reset-users-for-authentik.cjs` | Supprime tous les utilisateurs (migration CAS → Authentik, déjà exécutée).                | `npm run db:reset-users`                                     |
| `migrate-export-db.cjs`         | Importe albums/permissions/logs depuis une ancienne DB export (migration, déjà exécutée). | `node scripts/migrate-export-db.cjs <source.db> [target.db]` |
