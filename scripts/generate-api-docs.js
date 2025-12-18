

const API_KEY = 'mAvmLgRgT7J1pJCCNNi4szLalbaMdNq28aprqvn129I';
const BASE_URL = 'http://localhost:5173';

const results = {
	health: {
		'GET /api/health': {
			scope: 'read',
			description: "Statut de santé de l'API",
			response: {
				status: 'string',
				timestamp: 'ISO8601',
				database: 'string'
			}
		}
	},
	users: {
		'GET /api/users': {
			scope: 'admin',
			description: 'Liste de tous les utilisateurs',
			response: {
				success: true,
				users: [
					{
						id_user: 'string',
						email: 'string',
						prenom: 'string',
						nom: 'string',
						id_photos: 'uuid|null',
						role: 'user|admin|mitviste',
						promo_year: 0
					},
					'...'
				]
			}
		},
		'POST /api/users': {
			scope: 'admin',
			description: 'Créer un nouvel utilisateur',
			response: {
				success: true,
				created: {
					id_user: 'string',
					email: 'string',
					prenom: 'string',
					nom: 'string',
					id_photos: null,
					role: 'string',
					promo_year: null
				},
				changes: 0
			}
		}
	},
	apiKeys: {
		'GET /api/admin/api-keys': {
			scope: 'admin',
			description: 'Liste des clés API',
			response: {
				success: true,
				keys: [
					{
						id: 0,
						label: 'string',
						scopes: 'string',
						revoked: 0,
						created_at: 0
					},
					'...'
				]
			}
		},
		'POST /api/admin/api-keys': {
			scope: 'admin',
			description: 'Créer une clé API',
			response: {
				success: true,
				id: 0,
				rawKey: 'string'
			}
		}
	},
	people: {
		'GET /api/people/album/info': {
			scope: 'read',
			description: "Informations sur l'album Photos-CV",
			response: {
				id: 'uuid',
				name: 'string',
				assetCount: 0
			}
		}
	}
};

function generateEndpointsCode() {
	const groups = [
		{ name: 'Health', key: 'health', description: 'Endpoints de santé et status' },
		{ name: 'Users', key: 'users', description: 'Gestion des utilisateurs' },
		{ name: 'API Keys', key: 'apiKeys', description: 'Gestion des clés API' },
		{
			name: 'People & Photos-CV',
			key: 'people',
			description: 'Gestion des personnes et trombinoscope'
		}
	];

	console.log('

	for (const group of groups) {
		if (!results[group.key]) continue;

		console.log(`\t{`);
		console.log(`\t\tgroup: '${group.name}',`);
		console.log(`\t\titems: [`);

		for (const [endpoint, data] of Object.entries(results[group.key])) {
			const [method, path] = endpoint.split(' ');

			console.log(`\t\t\t{`);
			console.log(`\t\t\t\tmethod: '${method}',`);
			console.log(`\t\t\t\tpath: '${path}',`);
			console.log(`\t\t\t\tscope: '${data.scope}',`);
			console.log(`\t\t\t\tdescription: '${data.description}',`);
			console.log(`\t\t\t\texampleResponse: \`${JSON.stringify(data.response, null, 2)}\``);
			console.log(`\t\t\t},`);
		}

		console.log(`\t\t]`);
		console.log(`\t},\n`);
	}
}

generateEndpointsCode();
