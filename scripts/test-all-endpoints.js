/**
 * Script pour tester automatiquement tous les endpoints et capturer leurs schémas de réponse
 * Usage: node scripts/test-all-endpoints.js
 */

const API_KEY = 'mAvmLgRgT7J1pJCCNNi4szLalbaMdNq28aprqvn129I';
const BASE_URL = 'http://localhost:5173';

// Liste complète des endpoints à tester
const ENDPOINTS = [
	// ========== Health ==========
	{ method: 'GET', path: '/api/health', scope: 'read' },

	// ========== Users ==========
	{ method: 'GET', path: '/api/users', scope: 'admin' },
	{
		method: 'POST',
		path: '/api/users',
		scope: 'admin',
		body: {
			id_user: 'demo.test2',
			email: 'demo.test2@etu.emse.fr',
			prenom: 'Demo2',
			nom: 'Test2',
			role: 'user'
		}
	},

	// ========== API Keys ==========
	{ method: 'GET', path: '/api/admin/api-keys', scope: 'admin' },
	{
		method: 'POST',
		path: '/api/admin/api-keys',
		scope: 'admin',
		body: {
			label: 'Auto-generated Test Key',
			scopes: ['read', 'write']
		}
	},

	// ========== Favorites ==========
	{ method: 'GET', path: '/api/favorites', scope: 'read' },

	// ========== People ==========
	{ method: 'GET', path: '/api/people', scope: 'read' },
	{ method: 'GET', path: '/api/people/album/info', scope: 'read' },

	// ========== External Media ==========
	{ method: 'GET', path: '/api/external/media', scope: 'read' }

	// Note: Les endpoints nécessitant des IDs spécifiques (GET /api/users/{id}, etc.)
	// seront testés après avoir créé les ressources nécessaires
];

/**
 * Génère un schéma concis à partir d'un objet JSON
 */
function generateSchema(obj, depth = 0, maxDepth = 3) {
	if (obj === null) return 'null';
	if (obj === undefined) return 'undefined';

	const type = typeof obj;

	if (type === 'string') {
		// Détecter les formats spéciaux
		if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(obj)) return '"ISO8601"';
		if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(obj)) return '"uuid"';
		return '"string"';
	}

	if (type === 'number') {
		return Number.isInteger(obj) ? 0 : 0.0;
	}

	if (type === 'boolean') return obj;

	if (Array.isArray(obj)) {
		if (obj.length === 0) return [];
		if (depth >= maxDepth) return '[...]';
		const firstSchema = generateSchema(obj[0], depth + 1, maxDepth);
		// Si c'est un objet, le retourner tel quel
		if (typeof firstSchema === 'object' && firstSchema !== null) {
			return [firstSchema, '...'];
		}
		return `[${JSON.stringify(firstSchema)}, ...]`;
	}

	if (type === 'object') {
		if (depth >= maxDepth) return '{...}';

		const schema = {};
		const keys = Object.keys(obj);

		// Limiter le nombre de clés affichées selon la profondeur
		const maxKeys = depth === 0 ? 20 : 10;
		const displayKeys = keys.slice(0, maxKeys);
		const hasMore = keys.length > maxKeys;

		for (const key of displayKeys) {
			schema[key] = generateSchema(obj[key], depth + 1, maxDepth);
		}

		if (hasMore) {
			schema['...'] = '...';
		}

		return schema;
	}

	return String(obj);
}

/**
 * Teste un endpoint et retourne son schéma
 */
async function testEndpoint(endpoint) {
	const url = `${BASE_URL}${endpoint.path}`;

	try {
		const options = {
			method: endpoint.method,
			headers: {
				'x-api-key': API_KEY
			}
		};

		// Ajouter le body pour POST/PUT/PATCH
		if (endpoint.body && ['POST', 'PUT', 'PATCH'].includes(endpoint.method)) {
			options.headers['Content-Type'] = 'application/json';
			options.body = JSON.stringify(endpoint.body);
		}

		const response = await fetch(url, options);

		if (!response.ok) {
			return {
				...endpoint,
				error: `HTTP ${response.status}: ${response.statusText}`,
				schema: null
			};
		}

		const data = await response.json();

		// Générer le schéma
		const schema = generateSchema(data);

		return {
			...endpoint,
			status: response.status,
			schema: JSON.stringify(schema, null, 2)
		};
	} catch (error) {
		return {
			...endpoint,
			error: error.message,
			schema: null
		};
	}
}

/**
 * Teste tous les endpoints
 */
async function testAll() {
	console.log(`🧪 Test de ${ENDPOINTS.length} endpoints...\n`);

	const results = [];

	for (const endpoint of ENDPOINTS) {
		process.stdout.write(`Testing ${endpoint.method} ${endpoint.path}... `);

		const result = await testEndpoint(endpoint);
		results.push(result);

		if (result.error) {
			console.log(`❌ ${result.error}`);
		} else {
			console.log(`✅ ${result.status}`);
		}
	}

	console.log('\n' + '='.repeat(80));
	console.log('RÉSULTATS');
	console.log('='.repeat(80) + '\n');

	for (const result of results) {
		console.log(`\n${result.method} ${result.path}`);
		console.log(`Scope: ${result.scope}`);

		if (result.error) {
			console.log(`❌ Erreur: ${result.error}`);
		} else {
			console.log(`✅ Status: ${result.status}`);
			console.log(`\nSchéma de réponse:`);
			console.log(result.schema);
		}

		console.log('\n' + '-'.repeat(80));
	}

	// Résumé
	const success = results.filter((r) => !r.error).length;
	const failed = results.filter((r) => r.error).length;

	console.log(`\n📊 Résumé: ${success} réussis, ${failed} échoués sur ${ENDPOINTS.length} total`);
}

// Exécution
testAll().catch(console.error);
