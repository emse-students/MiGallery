import { error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';

/**
 * ❌ ENDPOINT DÉSACTIVÉ POUR RAISONS DE SÉCURITÉ
 *
 * Cet endpoint permettait l'exécution de SQL arbitraire et présentait de multiples
 * vulnérabilités critiques:
 *
 * 1. Bypass de validation via commentaires SQL, alias, sous-requêtes, UNION
 * 2. Aucune protection sur les tables api_keys, albums, favorites, etc.
 * 3. Permet DDL statements (DROP TABLE, ALTER TABLE, etc.)
 * 4. Information disclosure via messages d'erreur SQL
 * 5. Validation WHERE fragile et contournable
 *
 * Si vous avez besoin d'exécuter des requêtes SQL spécifiques, créez des endpoints
 * dédiés avec validation stricte des paramètres.
 *
 * Pour debug/dev uniquement: Utiliser les endpoints /api/admin/db-* avec des
 * opérations prédéfinies et sécurisées.
 */
export const POST: RequestHandler = () => {
	throw error(404, 'Not Found');
};
