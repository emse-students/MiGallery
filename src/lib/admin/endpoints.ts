/**
 * Liste complète des endpoints de l'API MiGallery
 * Format: method, path, scope, description, exampleCurl, exampleResponse
 */

export interface Endpoint {
	method: string;
	path: string;
	scope: string;
	description: string;
	exampleCurl?: string;
	exampleResponse?: string;
}

export interface EndpointGroup {
	group: string;
	items: Endpoint[];
}

export const API_ENDPOINTS: EndpointGroup[] = [
	{
		group: 'Albums',
		items: [
			{
				method: 'GET',
				path: '/api/albums',
				scope: 'read',
				description: 'Liste de tous les albums',
				exampleCurl: 'curl -H "x-api-key: YOUR_API_KEY" "http://localhost:5173/api/albums"',
				exampleResponse: `[{
									"id": "uuid",
									"albumName": "string",
									"description": "string",
									"createdAt": "ISO8601",
									"updatedAt": "ISO8601",
									"ownerId": "uuid",
									"owner": {"id": "uuid", "email": "string", "name": "string", ...},
									"albumUsers": [],
									"shared": false,
									"assets": [],
									"assetCount": 0,
									...
									}]`
			},
			{
				method: 'POST',
				path: '/api/albums',
				scope: 'write',
				description: 'Créer un nouvel album',
				exampleCurl:
					'curl -X POST -H "x-api-key: YOUR_API_KEY" -H "Content-Type: application/json" -d \'{"albumName":"Mon Album","description":"Description"}\' "http://localhost:5173/api/albums"',
				exampleResponse:
					'{"id":"uuid","albumName":"Mon Album","description":"Description","createdAt":"ISO8601",...}'
			},
			{
				method: 'GET',
				path: '/api/albums/{id}',
				scope: 'read',
				description: "Détails d'un album",
				exampleCurl: 'curl -H "x-api-key: YOUR_API_KEY" "http://localhost:5173/api/albums/{id}"',
				exampleResponse: '{"id":"uuid","albumName":"string","description":"string","assets":[...],...}'
			},
			{
				method: 'PATCH',
				path: '/api/albums/{id}',
				scope: 'write',
				description: 'Modifier un album',
				exampleCurl:
					'curl -X PATCH -H "x-api-key: YOUR_API_KEY" -H "Content-Type: application/json" -d \'{"albumName":"Nouveau nom"}\' "http://localhost:5173/api/albums/{id}"',
				exampleResponse: '{"id":"uuid","albumName":"Nouveau nom",...}'
			},
			{
				method: 'DELETE',
				path: '/api/albums/{id}',
				scope: 'write',
				description: 'Supprimer un album',
				exampleCurl:
					'curl -X DELETE -H "x-api-key: YOUR_API_KEY" "http://localhost:5173/api/albums/{id}"',
				exampleResponse: '{"success":true}'
			},
			{
				method: 'GET',
				path: '/api/albums/{id}/info',
				scope: 'read',
				description: "Métadonnées d'un album",
				exampleCurl: 'curl -H "x-api-key: YOUR_API_KEY" "http://localhost:5173/api/albums/{id}/info"',
				exampleResponse:
					'{"id":"uuid","albumName":"string","assetCount":0,"startDate":"ISO8601","endDate":"ISO8601",...}'
			},
			{
				method: 'PUT',
				path: '/api/albums/{id}/metadata',
				scope: 'write',
				description: 'Mettre à jour les métadonnées',
				exampleCurl:
					'curl -X PUT -H "x-api-key: YOUR_API_KEY" -H "Content-Type: application/json" -d \'{"description":"Nouvelle description"}\' "http://localhost:5173/api/albums/{id}/metadata"',
				exampleResponse: '{"success":true}'
			},
			{
				method: 'GET',
				path: '/api/albums/{id}/assets-simple',
				scope: 'read',
				description: 'Liste simple des assets',
				exampleCurl:
					'curl -H "x-api-key: YOUR_API_KEY" "http://localhost:5173/api/albums/{id}/assets-simple"',
				exampleResponse: '[{"id":"uuid","type":"IMAGE","originalPath":"string",...},...]'
			},
			{
				method: 'GET',
				path: '/api/albums/{id}/assets-stream',
				scope: 'read',
				description: 'Stream NDJSON des assets',
				exampleCurl:
					'curl -H "x-api-key: YOUR_API_KEY" "http://localhost:5173/api/albums/{id}/assets-stream"',
				exampleResponse: '{"id":"uuid",...}\\n{"id":"uuid",...}\\n...'
			},
			{
				method: 'PUT',
				path: '/api/albums/{id}/assets',
				scope: 'write',
				description: 'Ajouter des assets à un album',
				exampleCurl:
					'curl -X PUT -H "x-api-key: YOUR_API_KEY" -H "Content-Type: application/json" -d \'{"ids":["asset-uuid-1","asset-uuid-2"]}\' "http://localhost:5173/api/albums/{id}/assets"',
				exampleResponse: '{"success":true,"addedCount":2}'
			},
			{
				method: 'DELETE',
				path: '/api/albums/{id}/assets',
				scope: 'write',
				description: "Retirer des assets d'un album",
				exampleCurl:
					'curl -X DELETE -H "x-api-key: YOUR_API_KEY" -H "Content-Type: application/json" -d \'{"ids":["asset-uuid"]}\' "http://localhost:5173/api/albums/{id}/assets"',
				exampleResponse: '{"success":true,"removedCount":1}'
			},
			{
				method: 'POST',
				path: '/api/albums/covers',
				scope: 'write',
				description: "Générer les covers d'albums",
				exampleCurl:
					'curl -X POST -H "x-api-key: YOUR_API_KEY" "http://localhost:5173/api/albums/covers"',
				exampleResponse: '{"processed":5,"success":true}'
			},
			{
				method: 'GET',
				path: '/api/albums/{id}/asset-thumbnail/{assetId}',
				scope: 'read',
				description: "Thumbnail d'un asset",
				exampleCurl:
					'curl -H "x-api-key: YOUR_API_KEY" "http://localhost:5173/api/albums/{id}/asset-thumbnail/{assetId}" --output thumbnail.jpg',
				exampleResponse: '[Binary image data]'
			},
			{
				method: 'GET',
				path: '/api/albums/{id}/asset-thumbnail/{assetId}/thumbnail',
				scope: 'read',
				description: 'Thumbnail alternatif',
				exampleCurl:
					'curl -H "x-api-key: YOUR_API_KEY" "http://localhost:5173/api/albums/{id}/asset-thumbnail/{assetId}/thumbnail" --output thumb.jpg',
				exampleResponse: '[Binary image data]'
			},
			{
				method: 'GET',
				path: '/api/albums/{id}/asset-original/{assetId}',
				scope: 'read',
				description: 'Asset original',
				exampleCurl:
					'curl -H "x-api-key: YOUR_API_KEY" "http://localhost:5173/api/albums/{id}/asset-original/{assetId}" --output original.jpg',
				exampleResponse: '[Binary image data]'
			}
		]
	},
	{
		group: 'Users',
		items: [
			{
				method: 'GET',
				path: '/api/users',
				scope: 'admin',
				description: 'Liste de tous les utilisateurs',
				exampleCurl: 'curl -H "x-api-key: YOUR_ADMIN_KEY" "http://localhost:5173/api/users"',
				exampleResponse: `{
  "success": true,
  "users": [{
    "id_user": "string",
    "email": "string",
    "prenom": "string",
    "nom": "string",
    "id_photos": "uuid|null",
    "role": "user|admin|mitviste",
    "promo_year": 0
  }, ...]
}`
			},
			{
				method: 'POST',
				path: '/api/users',
				scope: 'admin',
				description: 'Créer un nouvel utilisateur',
				exampleCurl:
					'curl -X POST -H "x-api-key: YOUR_ADMIN_KEY" -H "Content-Type: application/json" -d \'{"id_user":"john.doe","email":"john.doe@etu.emse.fr","prenom":"John","nom":"Doe","role":"user"}\' "http://localhost:5173/api/users"',
				exampleResponse: `{
  "success": true,
  "created": {
    "id_user": "string",
    "email": "string",
    "prenom": "string",
    "nom": "string",
    "id_photos": null,
    "role": "string",
    "promo_year": null
  },
  "changes": 0
}`
			},
			{
				method: 'GET',
				path: '/api/users/{id}',
				scope: 'admin',
				description: "Détails d'un utilisateur",
				exampleCurl: 'curl -H "x-api-key: YOUR_ADMIN_KEY" "http://localhost:5173/api/users/{id}"',
				exampleResponse:
					'{"success":true,"user":{"id_user":"string","email":"string","prenom":"string","nom":"string",...}}'
			},
			{
				method: 'PUT',
				path: '/api/users/{id}',
				scope: 'admin',
				description: 'Modifier un utilisateur',
				exampleCurl:
					'curl -X PUT -H "x-api-key: YOUR_ADMIN_KEY" -H "Content-Type: application/json" -d \'{"prenom":"NewName"}\' "http://localhost:5173/api/users/{id}"',
				exampleResponse: '{"success":true,"updated":{"id_user":"string","prenom":"NewName",...}}'
			},
			{
				method: 'DELETE',
				path: '/api/users/{id}',
				scope: 'admin',
				description: 'Supprimer un utilisateur',
				exampleCurl:
					'curl -X DELETE -H "x-api-key: YOUR_ADMIN_KEY" "http://localhost:5173/api/users/{id}"',
				exampleResponse: '{"success":true,"deleted":1}'
			},
			{
				method: 'PATCH',
				path: '/api/users/me/promo',
				scope: 'read',
				description: "Mettre à jour l'année de promotion de l'utilisateur connecté",
				exampleCurl:
					'curl -X PATCH -H "x-api-key: YOUR_API_KEY" -H "Content-Type: application/json" -d \'{"promo_year":2024}\' "http://localhost:5173/api/users/me/promo"',
				exampleResponse: '{"success":true,"user":{"id_user":"string","promo_year":2024,...}}'
			},
			{
				method: 'GET',
				path: '/api/users/{username}/avatar',
				scope: 'read',
				description: "Avatar d'un utilisateur",
				exampleCurl:
					'curl -H "x-api-key: YOUR_API_KEY" "http://localhost:5173/api/users/{username}/avatar" --output avatar.jpg',
				exampleResponse: '[Binary image data]'
			}
		]
	},
	{
		group: 'People & Photos-CV',
		items: [
			{
				method: 'GET',
				path: '/api/people',
				scope: 'read',
				description: 'Liste des personnes disponibles',
				exampleCurl: 'curl -H "x-api-key: YOUR_API_KEY" "http://localhost:5173/api/people"',
				exampleResponse: '{"people":[{"id":"uuid","name":"string","birthDate":"ISO8601",...},...]}'
			},
			{
				method: 'POST',
				path: '/api/people',
				scope: 'write',
				description: 'Créer une nouvelle personne',
				exampleCurl:
					'curl -X POST -H "x-api-key: YOUR_API_KEY" -H "Content-Type: application/json" -d \'{"name":"John Doe","birthDate":"1990-01-01"}\' "http://localhost:5173/api/people"',
				exampleResponse: '{"id":"uuid","name":"John Doe","birthDate":"1990-01-01",...}'
			},
			{
				method: 'GET',
				path: '/api/people/people',
				scope: 'read',
				description: 'Liste complète des personnes',
				exampleCurl: 'curl -H "x-api-key: YOUR_API_KEY" "http://localhost:5173/api/people/people"',
				exampleResponse: '[{"id":"uuid","name":"string",...},...]'
			},
			{
				method: 'GET',
				path: '/api/people/people/{personId}/photos',
				scope: 'read',
				description: "Photos d'une personne",
				exampleCurl:
					'curl -H "x-api-key: YOUR_API_KEY" "http://localhost:5173/api/people/people/{personId}/photos"',
				exampleResponse: '[{"id":"uuid","type":"IMAGE","originalPath":"string",...},...]'
			},
			{
				method: 'GET',
				path: '/api/people/people/{personId}/photos-stream',
				scope: 'read',
				description: 'Stream NDJSON des photos',
				exampleCurl:
					'curl -H "x-api-key: YOUR_API_KEY" "http://localhost:5173/api/people/people/{personId}/photos-stream"',
				exampleResponse: '{"id":"uuid",...}\\n{"id":"uuid",...}\\n...'
			},
			{
				method: 'GET',
				path: '/api/people/person/{id}/my-photos',
				scope: 'read',
				description: "Mes photos d'une personne",
				exampleCurl:
					'curl -H "x-api-key: YOUR_API_KEY" "http://localhost:5173/api/people/person/{id}/my-photos"',
				exampleResponse: '[{"id":"uuid","type":"IMAGE",...},...]'
			},
			{
				method: 'GET',
				path: '/api/people/person/{id}/album-photos',
				scope: 'read',
				description: "Photos album d'une personne",
				exampleCurl:
					'curl -H "x-api-key: YOUR_API_KEY" "http://localhost:5173/api/people/person/{id}/album-photos"',
				exampleResponse: '[{"id":"uuid","type":"IMAGE",...},...]'
			},
			{
				method: 'GET',
				path: '/api/people/album',
				scope: 'read',
				description: 'Album des personnes',
				exampleCurl: 'curl -H "x-api-key: YOUR_API_KEY" "http://localhost:5173/api/people/album"',
				exampleResponse: '{"id":"uuid","albumName":"Photos-CV",...}'
			},
			{
				method: 'GET',
				path: '/api/people/album/info',
				scope: 'read',
				description: "Informations sur l'album Photos-CV",
				exampleCurl: 'curl -H "x-api-key: YOUR_API_KEY" "http://localhost:5173/api/people/album/info"',
				exampleResponse: `{
  "id": "uuid",
  "name": "string",
  "assetCount": 0
}`
			},
			{
				method: 'PUT',
				path: '/api/people/album/assets',
				scope: 'write',
				description: "Ajouter assets à l'album personnes",
				exampleCurl:
					'curl -X PUT -H "x-api-key: YOUR_API_KEY" -H "Content-Type: application/json" -d \'{"ids":["asset-uuid"]}\' "http://localhost:5173/api/people/album/assets"',
				exampleResponse: '{"success":true,"addedCount":1}'
			},
			{
				method: 'DELETE',
				path: '/api/people/album/assets',
				scope: 'write',
				description: "Retirer assets de l'album personnes",
				exampleCurl:
					'curl -X DELETE -H "x-api-key: YOUR_API_KEY" -H "Content-Type: application/json" -d \'{"ids":["asset-uuid"]}\' "http://localhost:5173/api/people/album/assets"',
				exampleResponse: '{"success":true,"removedCount":1}'
			},
			{
				method: 'GET',
				path: '/api/people/album/{albumId}/assets',
				scope: 'read',
				description: "Assets d'un album de personnes",
				exampleCurl:
					'curl -H "x-api-key: YOUR_API_KEY" "http://localhost:5173/api/people/album/{albumId}/assets"',
				exampleResponse: '[{"id":"uuid","type":"IMAGE",...},...]'
			},
			{
				method: 'PUT',
				path: '/api/people/album/{albumId}/assets',
				scope: 'write',
				description: 'Ajouter assets',
				exampleCurl:
					'curl -X PUT -H "x-api-key: YOUR_API_KEY" -H "Content-Type: application/json" -d \'{"ids":["uuid"]}\' "http://localhost:5173/api/people/album/{albumId}/assets"',
				exampleResponse: '{"success":true,"addedCount":1}'
			},
			{
				method: 'DELETE',
				path: '/api/people/album/{albumId}/assets',
				scope: 'write',
				description: 'Retirer assets',
				exampleCurl:
					'curl -X DELETE -H "x-api-key: YOUR_API_KEY" -H "Content-Type: application/json" -d \'{"ids":["uuid"]}\' "http://localhost:5173/api/people/album/{albumId}/assets"',
				exampleResponse: '{"success":true,"removedCount":1}'
			}
		]
	},
	{
		group: 'External Media',
		items: [
			{
				method: 'GET',
				path: '/api/external/media',
				scope: 'read',
				description: 'Liste des médias externes',
				exampleCurl: 'curl -H "x-api-key: YOUR_API_KEY" "http://localhost:5173/api/external/media"',
				exampleResponse: `{
  "success": true,
  "assets": [{
    "id": "uuid",
    "createdAt": "ISO8601",
    "deviceAssetId": "string",
    "ownerId": "uuid",
    "deviceId": "string",
    "type": "string",
    "originalPath": "string",
    "originalFileName": "string"
  }, ...]
}`
			},
			{
				method: 'POST',
				path: '/api/external/media',
				scope: 'write',
				description: 'Uploader un média externe',
				exampleCurl:
					'curl -X POST -H "x-api-key: YOUR_API_KEY" -F "file=@image.jpg" "http://localhost:5173/api/external/media"',
				exampleResponse: '{"success":true,"id":"uuid","originalPath":"string",...}'
			},
			{
				method: 'DELETE',
				path: '/api/external/media',
				scope: 'write',
				description: 'Supprimer des médias externes',
				exampleCurl:
					'curl -X DELETE -H "x-api-key: YOUR_API_KEY" -H "Content-Type: application/json" -d \'{"ids":["uuid1","uuid2"]}\' "http://localhost:5173/api/external/media"',
				exampleResponse: '{"success":true,"deletedCount":2}'
			},
			{
				method: 'GET',
				path: '/api/external/media/{id}',
				scope: 'read',
				description: "Détails d'un média externe",
				exampleCurl:
					'curl -H "x-api-key: YOUR_API_KEY" "http://localhost:5173/api/external/media/{id}"',
				exampleResponse: '{"id":"uuid","type":"IMAGE","originalPath":"string",...}'
			},
			{
				method: 'DELETE',
				path: '/api/external/media/{id}',
				scope: 'write',
				description: 'Supprimer un média externe',
				exampleCurl:
					'curl -X DELETE -H "x-api-key: YOUR_API_KEY" "http://localhost:5173/api/external/media/{id}"',
				exampleResponse: '{"success":true}'
			}
		]
	},
	{
		group: 'API Keys',
		items: [
			{
				method: 'GET',
				path: '/api/admin/api-keys',
				scope: 'admin',
				description: 'Liste des clés API',
				exampleCurl: 'curl -H "x-api-key: YOUR_ADMIN_KEY" "http://localhost:5173/api/admin/api-keys"',
				exampleResponse: `{
  "success": true,
  "keys": [{
    "id": 0,
    "label": "string",
    "scopes": "string",
    "revoked": 0,
    "created_at": 0
  }, ...]
}`
			},
			{
				method: 'POST',
				path: '/api/admin/api-keys',
				scope: 'admin',
				description: 'Créer une clé API',
				exampleCurl:
					'curl -X POST -H "x-api-key: YOUR_ADMIN_KEY" -H "Content-Type: application/json" -d \'{"label":"My API Key","scopes":["read","write"]}\' "http://localhost:5173/api/admin/api-keys"',
				exampleResponse: `{
  "success": true,
  "id": 0,
  "rawKey": "string"
}`
			},
			{
				method: 'DELETE',
				path: '/api/admin/api-keys/{id}',
				scope: 'admin',
				description: 'Supprimer une clé API',
				exampleCurl:
					'curl -X DELETE -H "x-api-key: YOUR_ADMIN_KEY" "http://localhost:5173/api/admin/api-keys/{id}"',
				exampleResponse: '{"success":true,"deleted":1}'
			}
		]
	},
	{
		group: 'Database',
		items: [
			{
				method: 'POST',
				path: '/api/admin/db-backup',
				scope: 'admin',
				description: 'Créer une sauvegarde de la base de données',
				exampleCurl:
					'curl -X POST -H "x-api-key: YOUR_ADMIN_KEY" "http://localhost:5173/api/admin/db-backup"',
				exampleResponse: '{"success":true,"backupPath":"data/migallery.db.backup.timestamp"}'
			},
			{
				method: 'GET',
				path: '/api/admin/db-export',
				scope: 'admin',
				description: 'Exporter la base de données',
				exampleCurl:
					'curl -H "x-api-key: YOUR_ADMIN_KEY" "http://localhost:5173/api/admin/db-export" --output database.db',
				exampleResponse: '[Binary SQLite database file]'
			},
			{
				method: 'POST',
				path: '/api/admin/db-import',
				scope: 'admin',
				description: 'Importer une base de données',
				exampleCurl:
					'curl -X POST -H "x-api-key: YOUR_ADMIN_KEY" -F "file=@database.db" "http://localhost:5173/api/admin/db-import"',
				exampleResponse: '{"success":true,"imported":true}'
			},
			{
				method: 'POST',
				path: '/api/admin/db-restore',
				scope: 'admin',
				description: 'Restaurer une sauvegarde de la base de données',
				exampleCurl:
					'curl -X POST -H "x-api-key: YOUR_ADMIN_KEY" -H "Content-Type: application/json" -d \'{"backupFile":"migallery.db.backup.timestamp"}\' "http://localhost:5173/api/admin/db-restore"',
				exampleResponse: '{"success":true,"restored":true}'
			},
			{
				method: 'GET',
				path: '/api/admin/db-inspect',
				scope: 'admin',
				description: 'Inspecter la base de données pour détecter les erreurs',
				exampleCurl: 'curl -H "x-api-key: YOUR_ADMIN_KEY" "http://localhost:5173/api/admin/db-inspect"',
				exampleResponse:
					'{"success":true,"hasErrors":false,"errors":[],"output":"Inspection output..."}'
			}
		]
	},
	{
		group: 'Favorites',
		items: [
			{
				method: 'GET',
				path: '/api/favorites',
				scope: 'read',
				description: 'Liste des favoris',
				exampleCurl: 'curl -H "x-api-key: YOUR_API_KEY" "http://localhost:5173/api/favorites"',
				exampleResponse: `{
  "favorites": []
}`
			},
			{
				method: 'POST',
				path: '/api/favorites',
				scope: 'write',
				description: 'Ajouter aux favoris',
				exampleCurl:
					'curl -X POST -H "x-api-key: YOUR_API_KEY" -H "Content-Type: application/json" -d \'{"assetId":"uuid"}\' "http://localhost:5173/api/favorites"',
				exampleResponse: `{
  "success": true,
  "isFavorite": true
}`
			},
			{
				method: 'DELETE',
				path: '/api/favorites',
				scope: 'write',
				description: 'Retirer des favoris',
				exampleCurl:
					'curl -X DELETE -H "x-api-key: YOUR_API_KEY" -H "Content-Type: application/json" -d \'{"assetId":"uuid"}\' "http://localhost:5173/api/favorites"',
				exampleResponse: `{
  "success": true,
  "isFavorite": false
}`
			}
		]
	},
	{
		group: 'Health',
		items: [
			{
				method: 'GET',
				path: '/api/health',
				scope: 'read',
				description: "Statut de santé de l'API",
				exampleCurl: 'curl -H "x-api-key: YOUR_API_KEY" "http://localhost:5173/api/health"',
				exampleResponse: `{
  "status": "ok",
  "timestamp": "ISO8601",
  "database": "connected"
}`
			}
		]
	},
	{
		group: 'Admin',
		items: [
			{
				method: 'POST',
				path: '/api/change-user',
				scope: 'admin',
				description: "Changer l'utilisateur actif (pour admin uniquement)",
				exampleCurl:
					'curl -X POST -H "x-api-key: YOUR_ADMIN_KEY" -H "Content-Type: application/json" -d \'{"userId":"john.doe"}\' "http://localhost:5173/api/change-user"',
				exampleResponse: '{"success":true}'
			}
		]
	},
	{
		group: 'Immich Proxy',
		items: [
			{
				method: 'GET',
				path: '/api/immich/{path}',
				scope: 'read',
				description: 'Proxy lecture Immich (GET)',
				exampleCurl:
					'curl -H "x-api-key: YOUR_API_KEY" "http://localhost:5173/api/immich/server-info/version"',
				exampleResponse: '{"major":1,"minor":118,"patch":2}'
			},
			{
				method: 'POST',
				path: '/api/immich/{path}',
				scope: 'write',
				description: 'Proxy écriture Immich (POST)',
				exampleCurl:
					'curl -X POST -H "x-api-key: YOUR_API_KEY" -H "Content-Type: application/json" -d \'{"data":"value"}\' "http://localhost:5173/api/immich/{path}"',
				exampleResponse: '{...}'
			},
			{
				method: 'PUT',
				path: '/api/immich/{path}',
				scope: 'write',
				description: 'Proxy écriture Immich (PUT)',
				exampleCurl:
					'curl -X PUT -H "x-api-key: YOUR_API_KEY" -H "Content-Type: application/json" -d \'{"data":"value"}\' "http://localhost:5173/api/immich/{path}"',
				exampleResponse: '{...}'
			},
			{
				method: 'PATCH',
				path: '/api/immich/{path}',
				scope: 'write',
				description: 'Proxy écriture Immich (PATCH)',
				exampleCurl:
					'curl -X PATCH -H "x-api-key: YOUR_API_KEY" -H "Content-Type: application/json" -d \'{"data":"value"}\' "http://localhost:5173/api/immich/{path}"',
				exampleResponse: '{...}'
			},
			{
				method: 'DELETE',
				path: '/api/immich/{path}',
				scope: 'write',
				description: 'Proxy écriture Immich (DELETE)',
				exampleCurl:
					'curl -X DELETE -H "x-api-key: YOUR_API_KEY" "http://localhost:5173/api/immich/{path}"',
				exampleResponse: '{...}'
			}
		]
	}
];

export default API_ENDPOINTS;
