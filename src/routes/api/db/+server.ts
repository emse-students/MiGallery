import { error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';

/**
 * ❌ ENDPOINT DISABLED FOR SECURITY REASONS
 *
 * This endpoint allowed arbitrary SQL execution and had multiple critical
 * vulnerabilities:
 *
 * 1. Validation bypass via SQL comments, aliases, subqueries, UNION
 * 2. No protection on api_keys, albums, favorites tables, etc.
 * 3. Allows DDL statements (DROP TABLE, ALTER TABLE, etc.)
 * 4. Information disclosure via SQL error messages
 * 5. Fragile and bypassable WHERE validation
 *
 * If you need to run specific SQL queries, create dedicated endpoints
 * with strict parameter validation.
 *
 * For debug/dev only: Use the /api/admin/db-* endpoints with
 * predefined and secure operations.
 */
export const POST: RequestHandler = () => {
	throw error(404, 'Not Found');
};
