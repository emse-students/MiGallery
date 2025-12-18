

const API_KEY = 'mAvmLgRgT7J1pJCCNNi4szLalbaMdNq28aprqvn129I';
const BASE_URL = 'http://localhost:5173';

const testData = {
	userId: null,
	apiKeyId: null,
	personId: null,
	albumId: null
};

async function testEndpoint(method, path, scope, body = null) {
	try {
		const options = {
			method,
			headers: { 'x-api-key': API_KEY }
		};

		if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
			options.headers['Content-Type'] = 'application/json';
			options.body = JSON.stringify(body);
		}

		const response = await fetch(`${BASE_URL}${path}`, options);

		if (!response.ok) {
			return { error: `HTTP ${response.status}` };
		}

		const data = await response.json();
		return { success: true, data, status: response.status };
	} catch (error) {
		return { error: error.message };
	}
}

function generateSchema(obj, depth = 0, maxDepth = 3) {
	if (obj === null) return null;
	if (obj === undefined) return undefined;

	const type = typeof obj;

	if (type === 'string') {
		if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(obj)) return '"ISO8601"';
		if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(obj)) return '"uuid"';
		return '"string"';
	}

	if (type === 'number') return Number.isInteger(obj) ? 0 : 0.0;
	if (type === 'boolean') return obj;

	if (Array.isArray(obj)) {
		if (obj.length === 0) return [];
		if (depth >= maxDepth) return '[...]';
		const firstSchema = generateSchema(obj[0], depth + 1, maxDepth);
		return typeof firstSchema === 'object' && firstSchema !== null
			? [firstSchema, '...']
			: `[${JSON.stringify(firstSchema)}, ...]`;
	}

	if (type === 'object') {
		if (depth >= maxDepth) return '{...}';
		const schema = {};
		const keys = Object.keys(obj);
		const maxKeys = depth === 0 ? 20 : 10;

		for (const key of keys.slice(0, maxKeys)) {
			schema[key] = generateSchema(obj[key], depth + 1, maxDepth);
		}

		if (keys.length > maxKeys) schema['...'] = '...';
		return schema;
	}

	return String(obj);
}

function generateCurl(method, path, scope, body = null) {
	let curl = `curl -H "x-api-key: YOUR_API_KEY"`;

	if (method !== 'GET') {
		curl += ` -X ${method}`;
	}

	if (body) {
		curl += ` -H "Content-Type: application/json" -d '${JSON.stringify(body)}'`;
	}

	curl += ` "http:
	return curl;
}

function formatEndpoint(method, path, scope, description, curl, response) {
	return `\t\t\t{
\t\t\t\tmethod: '${method}',
\t\t\t\tpath: '${path}',
\t\t\t\tscope: '${scope}',
\t\t\t\tdescription: '${description}',
\t\t\t\texampleCurl: \`${curl}\`,
\t\t\t\texampleResponse: \`${JSON.stringify(response, null, 2)}\`
\t\t\t},`;
}

async function documentAll() {
	console.log('🚀 Documentation automatique des endpoints MiGallery\n');

	const documented = [];

	// ========== HEALTH ==========
	console.log('Testing Health endpoints...');
	const health = await testEndpoint('GET', '/api/health', 'read');
	if (health.success) {
		documented.push({
			group: 'Health',
			code: formatEndpoint(
				'GET',
				'/api/health',
				'read',
				"Statut de santé de l'API",
				generateCurl('GET', '/api/health', 'read'),
				generateSchema(health.data)
			)
		});
	}

	console.log('Testing Users endpoints...');
	const users = await testEndpoint('GET', '/api/users', 'admin');
	if (users.success) {
		documented.push({
			group: 'Users',
			code: formatEndpoint(
				'GET',
				'/api/users',
				'admin',
				'Liste de tous les utilisateurs',
				generateCurl('GET', '/api/users', 'admin'),
				generateSchema(users.data)
			)
		});
	}

	const createUser = await testEndpoint('POST', '/api/users', 'admin', {
		id_user: 'auto.doc',
		email: 'auto.doc@etu.emse.fr',
		prenom: 'Auto',
		nom: 'Documentation',
		role: 'user'
	});
	if (createUser.success) {
		documented.push({
			group: 'Users',
			code: formatEndpoint(
				'POST',
				'/api/users',
				'admin',
				'Créer un nouvel utilisateur',
				generateCurl('POST', '/api/users', 'admin', {
					id_user: 'john.doe',
					email: 'john.doe@etu.emse.fr',
					prenom: 'John',
					nom: 'Doe',
					role: 'user'
				}),
				generateSchema(createUser.data)
			)
		});
	}

	console.log('Testing API Keys endpoints...');
	const apiKeys = await testEndpoint('GET', '/api/admin/api-keys', 'admin');
	if (apiKeys.success) {
		documented.push({
			group: 'API Keys',
			code: formatEndpoint(
				'GET',
				'/api/admin/api-keys',
				'admin',
				'Liste des clés API',
				generateCurl('GET', '/api/admin/api-keys', 'admin'),
				generateSchema(apiKeys.data)
			)
		});
	}

	const createKey = await testEndpoint('POST', '/api/admin/api-keys', 'admin', {
		label: 'Auto-generated Documentation Key',
		scopes: ['read']
	});
	if (createKey.success) {
		documented.push({
			group: 'API Keys',
			code: formatEndpoint(
				'POST',
				'/api/admin/api-keys',
				'admin',
				'Créer une clé API',
				generateCurl('POST', '/api/admin/api-keys', 'admin', {
					label: 'My API Key',
					scopes: ['read', 'write']
				}),
				generateSchema(createKey.data)
			)
		});
	}

	// ========== PEOPLE ==========
	console.log('Testing People endpoints...');
	const albumInfo = await testEndpoint('GET', '/api/people/album/info', 'read');
	if (albumInfo.success) {
		documented.push({
			group: 'People & Photos-CV',
			code: formatEndpoint(
				'GET',
				'/api/people/album/info',
				'read',
				"Informations sur l'album Photos-CV",
				generateCurl('GET', '/api/people/album/info', 'read'),
				generateSchema(albumInfo.data)
			)
		});
	}

	// ========== FAVORITES ==========
	console.log('Testing Favorites endpoints...');
	const favorites = await testEndpoint('GET', '/api/favorites', 'read');
	if (favorites.success) {
		documented.push({
			group: 'Favorites',
			code: formatEndpoint(
				'GET',
				'/api/favorites',
				'read',
				"Liste des favoris de l'utilisateur",
				generateCurl('GET', '/api/favorites', 'read'),
				generateSchema(favorites.data)
			)
		});
	}

	console.log('Testing External Media endpoints...');
	const externalMedia = await testEndpoint('GET', '/api/external/media', 'read');
	if (externalMedia.success) {
		documented.push({
			group: 'External Media',
			code: formatEndpoint(
				'GET',
				'/api/external/media',
				'read',
				'Liste des médias externes',
				generateCurl('GET', '/api/external/media', 'read'),
				generateSchema(externalMedia.data)
			)
		});
	}

	console.log('\n' + '='.repeat(80));
	console.log('CODE À COPIER DANS endpoints.ts');
	console.log('='.repeat(80) + '\n');

	const groups = {};
	for (const doc of documented) {
		if (!groups[doc.group]) groups[doc.group] = [];
		groups[doc.group].push(doc.code);
	}

	for (const [group, codes] of Object.entries(groups)) {
		console.log(`\t{`);
		console.log(`\t\tgroup: '${group}',`);
		console.log(`\t\titems: [`);
		for (const code of codes) {
			console.log(code);
		}
		console.log(`\t\t]`);
		console.log(`\t},\n`);
	}

	console.log(`\n✅ ${documented.length} endpoints documentés avec succès!`);
}

documentAll().catch(console.error);
