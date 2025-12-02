export const API_ENDPOINTS = [
	{
		group: 'Albums',
		description: 'Endpoints pour lire et modifier les albums (proxy Immich + local additions)',
		items: [
			{
				method: 'GET',
				path: '/api/albums',
				summary: 'Lister les albums',
				exampleCurl: 'curl "http://localhost:5173/api/albums"',
				requiredScopes: ['read'],
				noteAuth: 'Requiert: session ou x-api-key avec scope "read"'
			},
			{
				method: 'GET',
				path: '/api/albums/{id}',
				summary: "Détails d'un album",
				exampleCurl: 'curl "http://localhost:5173/api/albums/ALBUM_ID"',
				requiredScopes: ['read'],
				noteAuth: 'Requiert: session ou x-api-key avec scope "read"'
			},
			{
				method: 'GET',
				path: '/api/albums/{id}/info',
				summary: "Infos d'un album (métadonnées locales + Immich)",
				exampleCurl: 'curl "http://localhost:5173/api/albums/ALBUM_ID/info"',
				notes: 'Retourne le nom, date, location, visibility, tags et utilisateurs autorisés.',
				requiredScopes: ['read'],
				noteAuth: 'Requiert: session ou x-api-key avec scope "read"'
			},
			{
				method: 'GET',
				path: '/api/albums/{id}/assets-stream',
				summary: "Stream des assets d'un album (NDJSON)",
				exampleCurl: 'curl "http://localhost:5173/api/albums/ALBUM_ID/assets-stream"',
				notes:
					'Streaming progressif en NDJSON. Chaque ligne: {"phase":"minimal"|"full", "asset":{...}}',
				requiredScopes: ['read']
			},
			{
				method: 'POST',
				path: '/api/albums',
				summary: 'Créer un album (dans Immich et BDD locale)',
				exampleCurl:
					'curl -X POST -H "Content-Type: application/json" -H "x-api-key: YOUR_KEY" -d \'{"albumName":"Mon Album","date":"2025-11-19","location":"Saint-Étienne","visibility":"private","visible":true}\' "http://localhost:5173/api/albums"',
				notes: "Crée l'album dans Immich puis l'enregistre dans la base locale avec ses métadonnées",
				requiredScopes: ['write'],
				noteAuth: 'Requiert: session ou x-api-key avec scope "write"'
			},
			{
				method: 'PATCH',
				path: '/api/albums/{id}',
				summary: "Modifier les métadonnées d'un album (local DB uniquement)",
				exampleCurl:
					'curl -X PATCH -H "Content-Type: application/json" -H "x-api-key: YOUR_KEY" -d \'{"name":"Forum","date":"2025-11-04","tags":["Promo 2024"],"allowedUsers":["alice.bob"]}\' "http://localhost:5173/api/albums/ALBUM_ID"',
				notes:
					'Met à jour name, date, location, visibility, visible, tags et allowedUsers dans la BDD locale (pas Immich)',
				requiredScopes: ['write'],
				noteAuth: 'Requiert: session ou x-api-key avec scope "write"'
			},
			{
				method: 'DELETE',
				path: '/api/albums/{id}',
				summary: 'Supprimer un album',
				exampleCurl:
					'curl -X DELETE -H "x-api-key: YOUR_KEY" "http://localhost:5173/api/albums/ALBUM_ID"',
				requiredScopes: ['delete'],
				noteAuth: 'Requiert: session ou x-api-key avec scope "delete"'
			}
		]
	},

	{
		group: 'Assets',
		description: 'Opérations sur les assets (photos/vidéos) via le proxy Immich',
		items: [
			{
				method: 'GET',
				path: '/api/immich/assets',
				summary: 'Lister les assets (proxie Immich)',
				params: [{ name: 'query', in: 'query', desc: 'Query string pass-through vers Immich' }],
				exampleCurl:
					'curl -H "x-api-key: YOUR_KEY" "http://localhost:5173/api/immich/assets?size=thumbnail"',
				notes: 'Cette route proxie Immich directement.',
				requiredScopes: ['read'],
				noteAuth: 'Requiert: session ou x-api-key avec scope "read"'
			},
			{
				method: 'GET',
				path: '/api/immich/assets/{id}/thumbnail',
				summary: "Récupérer la vignette d'un asset",
				params: [{ name: 'id', in: 'path', desc: 'Immich asset id (UUID)' }],
				exampleCurl:
					'curl -H "x-api-key: YOUR_KEY" "http://localhost:5173/api/immich/assets/ASSET_ID/thumbnail?size=thumbnail"',
				requiredScopes: ['read']
			},
			{
				method: 'GET',
				path: '/api/immich/assets/{id}/original',
				summary: 'Récupérer la ressource originale (proxy)',
				exampleCurl:
					'curl -H "x-api-key: YOUR_KEY" "http://localhost:5173/api/immich/assets/ASSET_ID/original"',
				requiredScopes: ['read']
			}
		]
	},

	{
		group: 'People & Photos-CV',
		description: "Endpoints pour les personnes reconnues et l'album système PhotoCV",
		items: [
			{
				method: 'GET',
				path: '/api/people/people',
				summary: 'Lister toutes les personnes reconnues par Immich',
				exampleCurl: 'curl -H "x-api-key: YOUR_KEY" "http://localhost:5173/api/people/people"',
				requiredScopes: ['read']
			},
			{
				method: 'GET',
				path: '/api/people/people/{personId}/photos',
				summary: "Photos d'une personne (non PhotoCV)",
				exampleCurl:
					'curl -H "x-api-key: YOUR_KEY" "http://localhost:5173/api/people/people/PERSON_ID/photos"',
				requiredScopes: ['read']
			},
			{
				method: 'GET',
				path: '/api/people/people/{personId}/photos-stream',
				summary: "Stream des photos d'une personne (NDJSON)",
				exampleCurl:
					'curl -H "x-api-key: YOUR_KEY" "http://localhost:5173/api/people/people/PERSON_ID/photos-stream"',
				requiredScopes: ['read']
			},
			{
				method: 'GET',
				path: '/api/people/person/{id}/my-photos',
				summary: 'Mes photos (exclut system albums)',
				exampleCurl:
					'curl -H "x-api-key: YOUR_KEY" "http://localhost:5173/api/people/person/USER_ID/my-photos"',
				requiredScopes: ['read']
			},
			{
				method: 'GET',
				path: '/api/people/person/{id}/album-photos',
				summary: "Photos de la personne dans l'album PhotoCV",
				exampleCurl:
					'curl -H "x-api-key: YOUR_KEY" "http://localhost:5173/api/people/person/USER_ID/album-photos"',
				requiredScopes: ['read']
			},
			{
				method: 'GET',
				path: '/api/people/album/{albumId}/assets',
				summary: "Lister les assets d'un album PhotoCV",
				exampleCurl:
					'curl -H "x-api-key: YOUR_KEY" "http://localhost:5173/api/people/album/ALBUM_ID/assets"',
				requiredScopes: ['read']
			},
			{
				method: 'PUT',
				path: '/api/people/album/assets',
				summary: "Ajouter des assets à l'album PhotoCV (body: { assetIds: [] })",
				exampleCurl:
					'curl -X PUT -H "Content-Type: application/json" -H "x-api-key: YOUR_KEY" -d \'{"assetIds":["id1","id2"]}\' http://localhost:5173/api/people/album/assets',
				requiredScopes: ['write']
			},
			{
				method: 'DELETE',
				path: '/api/people/album/assets',
				summary: "Retirer des assets de l'album PhotoCV (body: { assetIds: [] })",
				exampleCurl:
					'curl -X DELETE -H "Content-Type: application/json" -H "x-api-key: YOUR_KEY" -d \'{"assetIds":["id1"]}\' http://localhost:5173/api/people/album/assets',
				requiredScopes: ['delete']
			}
		]
	},

	{
		group: 'Users',
		description: 'Gestion des utilisateurs locaux et profils',
		items: [
			{
				method: 'GET',
				path: '/api/users',
				summary: 'Lister tous les utilisateurs (admin only)',
				exampleCurl: 'curl -H "x-api-key: YOUR_ADMIN_KEY" http://localhost:5173/api/users',
				noteAuth: 'Requiert: session admin ou x-api-key avec scope "admin"',
				requiredScopes: ['admin']
			},
			{
				method: 'POST',
				path: '/api/users',
				summary: 'Créer un utilisateur (admin only)',
				exampleCurl:
					'curl -X POST -H "Content-Type: application/json" -H "x-api-key: YOUR_ADMIN_KEY" -d \'{"id_user":"john.doe","email":"john.doe@etu.emse.fr","prenom":"John","nom":"Doe"}\' http://localhost:5173/api/users',
				requiredScopes: ['admin'],
				noteAuth: 'Admin uniquement'
			},
			{
				method: 'GET',
				path: '/api/users/{id}',
				summary: 'Récupérer un utilisateur par id_user',
				exampleCurl: 'curl -H "x-api-key: YOUR_KEY" "http://localhost:5173/api/users/USER_ID"',
				requiredScopes: ['read'],
				noteAuth: 'Lecture: scope "read" ou propriétaire. Modification: scope "admin" ou propriétaire.'
			},
			{
				method: 'PUT',
				path: '/api/users/{id}',
				summary: 'Modifier un utilisateur',
				exampleCurl:
					'curl -X PUT -H "Content-Type: application/json" -H "x-api-key: YOUR_KEY" -d \'{"prenom":"Jane","nom":"Smith"}\' "http://localhost:5173/api/users/USER_ID"',
				requiredScopes: ['write', 'admin'],
				noteAuth: 'Admin ou propriétaire du compte'
			},
			{
				method: 'DELETE',
				path: '/api/users/{id}',
				summary: 'Supprimer un utilisateur (admin only)',
				exampleCurl:
					'curl -X DELETE -H "x-api-key: YOUR_ADMIN_KEY" "http://localhost:5173/api/users/USER_ID"',
				requiredScopes: ['admin'],
				noteAuth: 'Admin uniquement'
			},
			{
				method: 'GET',
				path: '/api/users/{id_user}/avatar',
				summary: "Photo de profil d'un utilisateur (par id_user)",
				exampleCurl:
					'curl -H "x-api-key: YOUR_KEY" "http://localhost:5173/api/users/jolan.boudin/avatar"',
				noteAuth:
					'Requiert: session, auth provider, ou x-api-key avec scope "read". L\'utilisateur doit avoir un id_photos configuré (sinon 404).',
				requiredScopes: ['read']
			}
		]
	},

	{
		group: 'API Keys (Administration)',
		description: 'Créer / lister / révoquer des clés API pour usage programmatique sans session web',
		items: [
			{
				method: 'GET',
				path: '/api/admin/api-keys',
				summary: 'Lister les clés API (admin)',
				exampleCurl: 'curl -H "x-api-key: YOUR_ADMIN_KEY" http://localhost:5173/api/admin/api-keys',
				requiredScopes: ['admin'],
				noteAuth: 'Admin uniquement'
			},
			{
				method: 'POST',
				path: '/api/admin/api-keys',
				summary: 'Créer une clé API (admin) — retourne la clé brute une seule fois',
				exampleCurl:
					'curl -X POST -H "Content-Type: application/json" -H "x-api-key: YOUR_ADMIN_KEY" -d \'{"label":"service1","scopes":["read","write"]}\' http://localhost:5173/api/admin/api-keys',
				notes: 'Scopes disponibles: read, write, delete, admin',
				requiredScopes: ['admin']
			},
			{
				method: 'DELETE',
				path: '/api/admin/api-keys/{id}',
				summary: 'Révoquer une clé (admin)',
				exampleCurl:
					'curl -X DELETE -H "x-api-key: YOUR_ADMIN_KEY" http://localhost:5173/api/admin/api-keys/ID',
				requiredScopes: ['admin']
			}
		]
	},

	{
		group: 'External uploads (PortailEtu)',
		description: 'Endpoints pour intégration PortailEtu (protégés par x-api-key)',
		items: [
			{
				method: 'POST',
				path: '/api/external/media',
				summary: "Uploader des médias vers l'album PortailEtu",
				exampleCurl:
					'curl -X POST -H "x-api-key: YOUR_KEY" -F \'file=@photo.jpg\' http://localhost:5173/api/external/media',
				notes:
					"Upload multipart/form-data vers Immich, puis ajoute automatiquement à l'album système PortailEtu",
				requiredScopes: ['write'],
				noteAuth: 'Requiert header x-api-key avec scope "write"'
			},
			{
				method: 'GET',
				path: '/api/external/media',
				summary: "Lister les médias de l'album PortailEtu",
				exampleCurl: 'curl -H "x-api-key: YOUR_KEY" http://localhost:5173/api/external/media',
				requiredScopes: ['read'],
				noteAuth: 'Requiert header x-api-key avec scope "read"'
			},
			{
				method: 'DELETE',
				path: '/api/external/media',
				summary: "Supprimer des médias de l'album PortailEtu",
				exampleCurl:
					'curl -X DELETE -H "Content-Type: application/json" -H "x-api-key: YOUR_KEY" -d \'{"assetIds":["id1","id2"]}\' http://localhost:5173/api/external/media',
				notes: "Body: { assetIds: string[] }. Supprime définitivement les assets d'Immich (force=true)",
				requiredScopes: ['write'],
				noteAuth: 'Requiert header x-api-key avec scope "write"'
			},
			{
				method: 'GET',
				path: '/api/external/media/{id}',
				summary: "Récupérer la thumbnail d'un média PortailEtu",
				exampleCurl: 'curl -H "x-api-key: YOUR_KEY" http://localhost:5173/api/external/media/ASSET_ID',
				requiredScopes: ['read'],
				noteAuth: 'Requiert header x-api-key avec scope "read"'
			},
			{
				method: 'DELETE',
				path: '/api/external/media/{id}',
				summary: 'Supprimer un média spécifique de PortailEtu',
				exampleCurl:
					'curl -X DELETE -H "x-api-key: YOUR_KEY" http://localhost:5173/api/external/media/ASSET_ID',
				requiredScopes: ['write'],
				noteAuth: 'Requiert header x-api-key avec scope "write"'
			}
		]
	},

	{
		group: 'Health & Misc',
		description: 'Endpoints utilitaires et vérifications',
		items: [
			{
				method: 'GET',
				path: '/api/health',
				summary: 'Vérifier que le serveur est actif',
				exampleCurl: 'curl "http://localhost:5173/api/health"',
				notes: 'Retourne { status: "ok" }. Aucune authentification requise.',
				requiredScopes: []
			},
			{
				method: 'POST',
				path: '/api/change-user',
				summary: "Changer l'utilisateur actuel (dev only)",
				exampleCurl:
					'curl -X POST -H "Content-Type: application/json" -d \'{"username":"autre.user"}\' http://localhost:5173/api/change-user"',
				noteAuth: 'Endpoint de développement, désactivé en production.',
				requiredScopes: []
			}
		]
	},

	{
		group: 'Favorites',
		description: 'Gestion des favoris utilisateur (stockés localement, propres à chaque utilisateur)',
		items: [
			{
				method: 'GET',
				path: '/api/favorites',
				summary: "Récupérer tous les favoris de l'utilisateur connecté",
				exampleCurl: 'curl -H "Cookie: session=..." "http://localhost:5173/api/favorites"',
				notes:
					'Retourne { favorites: ["asset_id_1", "asset_id_2", ...] }. Les favoris sont propres à chaque utilisateur et ne sont pas partagés.',
				requiredScopes: [],
				noteAuth: 'Requiert une session utilisateur (cookie). Non accessible via x-api-key.'
			},
			{
				method: 'POST',
				path: '/api/favorites',
				summary: 'Ajouter une photo aux favoris',
				exampleCurl:
					'curl -X POST -H "Content-Type: application/json" -H "Cookie: session=..." -d \'{"assetId":"ASSET_UUID"}\' "http://localhost:5173/api/favorites"',
				notes: 'Body: { assetId: string }. Retourne { success: true, isFavorite: true }.',
				requiredScopes: [],
				noteAuth: 'Requiert une session utilisateur (cookie). Non accessible via x-api-key.'
			},
			{
				method: 'DELETE',
				path: '/api/favorites',
				summary: 'Retirer une photo des favoris',
				exampleCurl:
					'curl -X DELETE -H "Content-Type: application/json" -H "Cookie: session=..." -d \'{"assetId":"ASSET_UUID"}\' "http://localhost:5173/api/favorites"',
				notes: 'Body: { assetId: string }. Retourne { success: true, isFavorite: false }.',
				requiredScopes: [],
				noteAuth: 'Requiert une session utilisateur (cookie). Non accessible via x-api-key.'
			}
		]
	}
];

export default API_ENDPOINTS;
