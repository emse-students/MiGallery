

const API_KEY = 'mAvmLgRgT7J1pJCCNNi4szLalbaMdNq28aprqvn129I';
const BASE_URL = 'http://localhost:5173';

async function test(method, path, body = null) {
	const options = {
		method,
		headers: { 'x-api-key': API_KEY }
	};

	if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
		options.headers['Content-Type'] = 'application/json';
		options.body = JSON.stringify(body);
	}

	try {
		const res = await fetch(`${BASE_URL}${path}`, options);
		if (!res.ok) return { error: res.status };
		const data = await res.json();
		return { success: true, data };
	} catch (e) {
		return { error: e.message };
	}
}

function schema(obj, depth = 0) {
	if (obj === null) return null;
	if (obj === undefined) return undefined;
	if (typeof obj === 'string') {
		if (/^\d{4}-\d{2}-\d{2}T/.test(obj)) return '"ISO8601"';
		if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(obj)) return '"uuid"';
		return '"string"';
	}
	if (typeof obj === 'number') return Number.isInteger(obj) ? 0 : 0.0;
	if (typeof obj === 'boolean') return obj;
	if (Array.isArray(obj)) {
		if (obj.length === 0) return [];
		if (depth >= 3) return '[...]';
		const s = schema(obj[0], depth + 1);
		return typeof s === 'object' && s !== null ? [s, '...'] : `[${JSON.stringify(s)}, ...]`;
	}
	if (typeof obj === 'object') {
		if (depth >= 3) return '{...}';
		const result = {};
		const keys = Object.keys(obj);
		for (const key of keys.slice(0, depth === 0 ? 20 : 10)) {
			result[key] = schema(obj[key], depth + 1);
		}
		if (keys.length > (depth === 0 ? 20 : 10)) result['...'] = '...';
		return result;
	}
	return String(obj);
}

function curl(method, path, body = null) {
	let cmd = 'curl -H "x-api-key: YOUR_API_KEY"';
	if (method !== 'GET') cmd += ` -X ${method}`;
	if (body) cmd += ` -H "Content-Type: application/json" -d '${JSON.stringify(body)}'`;
	cmd += ` "http:
	return cmd;
}

function fmt(method, path, scope, desc, curlCmd, response) {
	return `\t\t\t{
\t\t\t\tmethod: '${method}',
\t\t\t\tpath: '${path}',
\t\t\t\tscope: '${scope}',
\t\t\t\tdescription: '${desc}',
\t\t\t\texampleCurl: \`${curlCmd}\`,
\t\t\t\texampleResponse: \`${JSON.stringify(response, null, 2)}\`
\t\t\t},`;
}

async function run() {
	console.log('🚀 Documentation massive des endpoints\n');

	const docs = {};
	const add = (group, code) => {
		if (!docs[group]) docs[group] = [];
		docs[group].push(code);
	};

	// ========== HEALTH ==========
	console.log('📊 Health...');
	const health = await test('GET', '/api/health');
	if (health.success) {
		add(
			'Health',
			fmt(
				'GET',
				'/api/health',
				'read',
				"Statut de santé de l'API",
				curl('GET', '/api/health'),
				schema(health.data)
			)
		);
	}

	console.log('👥 Users...');
	const users = await test('GET', '/api/users');
	if (users.success) {
		add(
			'Users',
			fmt(
				'GET',
				'/api/users',
				'admin',
				'Liste de tous les utilisateurs',
				curl('GET', '/api/users'),
				schema(users.data)
			)
		);
	}

	const createUser = await test('POST', '/api/users', {
		id_user: 'bulk.doc',
		email: 'bulk.doc@etu.emse.fr',
		prenom: 'Bulk',
		nom: 'Doc',
		role: 'user'
	});
	if (createUser.success) {
		add(
			'Users',
			fmt(
				'POST',
				'/api/users',
				'admin',
				'Créer un nouvel utilisateur',
				curl('POST', '/api/users', {
					id_user: 'john.doe',
					email: 'john.doe@etu.emse.fr',
					prenom: 'John',
					nom: 'Doe',
					role: 'user'
				}),
				schema(createUser.data)
			)
		);
	}

	console.log('🔑 API Keys...');
	const apiKeys = await test('GET', '/api/admin/api-keys');
	if (apiKeys.success) {
		add(
			'API Keys',
			fmt(
				'GET',
				'/api/admin/api-keys',
				'admin',
				'Liste des clés API',
				curl('GET', '/api/admin/api-keys'),
				schema(apiKeys.data)
			)
		);
	}

	const createKey = await test('POST', '/api/admin/api-keys', {
		label: 'Bulk Doc Key',
		scopes: ['read']
	});
	if (createKey.success) {
		add(
			'API Keys',
			fmt(
				'POST',
				'/api/admin/api-keys',
				'admin',
				'Créer une clé API',
				curl('POST', '/api/admin/api-keys', { label: 'My Key', scopes: ['read', 'write'] }),
				schema(createKey.data)
			)
		);
	}

	const revokeKey = await test('DELETE', '/api/admin/api-keys', {
		id: createKey.success ? createKey.data.id : 999
	});
	if (revokeKey.success) {
		add(
			'API Keys',
			fmt(
				'DELETE',
				'/api/admin/api-keys',
				'admin',
				'Révoquer une clé API',
				curl('DELETE', '/api/admin/api-keys', { id: 1 }),
				schema(revokeKey.data)
			)
		);
	}

	console.log('📸 People & Photos-CV...');
	const albumInfo = await test('GET', '/api/people/album/info');
	if (albumInfo.success) {
		add(
			'People & Photos-CV',
			fmt(
				'GET',
				'/api/people/album/info',
				'read',
				"Informations sur l'album Photos-CV",
				curl('GET', '/api/people/album/info'),
				schema(albumInfo.data)
			)
		);
	}

	// ========== FAVORITES ==========
	console.log('⭐ Favorites...');
	const favorites = await test('GET', '/api/favorites');
	if (favorites.success) {
		add(
			'Favorites',
			fmt(
				'GET',
				'/api/favorites',
				'read',
				'Liste des favoris',
				curl('GET', '/api/favorites'),
				schema(favorites.data)
			)
		);
	}

	const addFavorite = await test('POST', '/api/favorites', { assetId: 'test-asset-uuid' });
	if (addFavorite.success) {
		add(
			'Favorites',
			fmt(
				'POST',
				'/api/favorites',
				'write',
				'Ajouter aux favoris',
				curl('POST', '/api/favorites', { assetId: 'uuid' }),
				schema(addFavorite.data)
			)
		);
	}

	const removeFavorite = await test('DELETE', '/api/favorites', { assetId: 'test-asset-uuid' });
	if (removeFavorite.success) {
		add(
			'Favorites',
			fmt(
				'DELETE',
				'/api/favorites',
				'write',
				'Retirer des favoris',
				curl('DELETE', '/api/favorites', { assetId: 'uuid' }),
				schema(removeFavorite.data)
			)
		);
	}

	console.log('🖼️ External Media...');
	const externalMedia = await test('GET', '/api/external/media');
	if (externalMedia.success) {
		add(
			'External Media',
			fmt(
				'GET',
				'/api/external/media',
				'read',
				'Liste des médias externes',
				curl('GET', '/api/external/media'),
				schema(externalMedia.data)
			)
		);
	}

	console.log('💾 Database...');

	console.log('\n' + '='.repeat(80));
	console.log('CODE POUR endpoints.ts');
	console.log('='.repeat(80) + '\n');

	let total = 0;
	for (const [group, codes] of Object.entries(docs)) {
		console.log(`\t{`);
		console.log(`\t\tgroup: '${group}',`);
		console.log(`\t\titems: [`);
		for (const code of codes) {
			console.log(code);
			total++;
		}
		console.log(`\t\t]`);
		console.log(`\t},\n`);
	}

	console.log(`✅ ${total} endpoints documentés !`);
}

run().catch(console.error);
