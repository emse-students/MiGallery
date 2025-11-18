export const API_ENDPOINTS = [
  {
    group: 'Assets',
    description: 'Opérations sur les assets (photos/vidéos) via le proxy Immich',
    items: [
      {
        method: 'GET',
        path: '/api/immich/assets',
        summary: 'Lister les assets (proxie Immich)',
        params: [{ name: 'query', in: 'query', desc: 'Query string pass-through vers Immich' }],
        exampleCurl: `curl -H "x-api-key: <YOUR_API_KEY>" "http://localhost:5173/api/immich/assets?size=thumbnail"`,
        notes: 'Cette route proxie Immich et peut accepter le header x-api-key pour accès programmatique si configuré.'
      },
      {
        method: 'GET',
        path: '/api/immich/assets/{id}/thumbnail',
        summary: 'Récupérer la vignette d\'un asset',
        params: [{ name: 'id', in: 'path', desc: 'Immich asset id (UUID)' }],
        exampleCurl: `curl -H "x-api-key: <YOUR_API_KEY>" "http://localhost:5173/api/immich/assets/ASSET_ID/thumbnail?size=thumbnail"`,
      },
      {
        method: 'GET',
        path: '/api/immich/assets/{id}/original',
        summary: 'Récupérer la ressource originale (proxy)',
        exampleCurl: `curl -H "x-api-key: <YOUR_API_KEY>" "http://localhost:5173/api/immich/assets/ASSET_ID/original"`,
      }
    ]
  },

  {
    group: 'Albums',
    description: 'Endpoints pour lire et modifier les albums (proxy Immich + local additions)',
    items: [
      { method: 'GET', path: '/api/albums', summary: 'Lister les albums', exampleCurl: `curl -H "x-api-key: <YOUR_API_KEY>" "http://localhost:5173/api/albums"` },
      { method: 'GET', path: '/api/albums/{id}', summary: 'Détails d\'un album', exampleCurl: `curl -H "x-api-key: <YOUR_API_KEY>" "http://localhost:5173/api/albums/ALBUM_ID"` }
    ]
  },

  {
    group: 'Photos-CV',
    description: 'Endpoints PhotoCV (personnes & album système PhotoCV)',
    items: [
      { method: 'GET', path: '/api/photos-cv/people/{personId}/photos', summary: 'Photos d\'une personne (non PhotoCV)', exampleCurl: `curl -H "x-api-key: <YOUR_API_KEY>" "http://localhost:5173/api/photos-cv/people/123/photos"` },
  { method: 'GET', path: '/api/photos-cv/person/{id}/my-photos', summary: 'Mes photos (exclut system albums)', exampleCurl: `curl "http://localhost:5173/api/photos-cv/person/<user_id>/my-photos"` },
  { method: 'GET', path: '/api/photos-cv/person/{id}/album-photos', summary: 'Photos de la personne dans l\'album PhotoCV', exampleCurl: `curl "http://localhost:5173/api/photos-cv/person/<user_id>/album-photos"` },
      { method: 'GET', path: '/api/photos-cv/album/{albumId}/assets', summary: 'Lister les assets d\'un album PhotoCV', exampleCurl: `curl "http://localhost:5173/api/photos-cv/album/ALBUM_ID/assets"` },
      { method: 'PUT', path: '/api/photos-cv/album/assets', summary: 'Ajouter des assets à l\'album PhotoCV (body: { assetIds: [] })', exampleCurl: `curl -X PUT -H "Content-Type: application/json" -d '{"assetIds":["id1","id2"]}' http://localhost:5173/api/photos-cv/album/assets` },
      { method: 'DELETE', path: '/api/photos-cv/album/assets', summary: 'Retirer des assets de l\'album PhotoCV (body: { assetIds: [] })', exampleCurl: `curl -X DELETE -H "Content-Type: application/json" -d '{"assetIds":["id1"]}' http://localhost:5173/api/photos-cv/album/assets` }
    ]
  },

  {
    group: 'Users',
    description: 'Gestion des utilisateurs locaux via endpoints REST sécurisés (admin required)',
    items: [
      { method: 'GET', path: '/api/users', summary: 'Lister tous les utilisateurs (admin only)', exampleCurl: `curl -H "Authorization: Bearer <SESSION_COOKIE>" http://localhost:5173/api/users`, noteAuth: 'Cet endpoint nécessite des privilèges admin. Utilisez la session provider ou un token admin si configuré.' },
  { method: 'GET', path: '/api/users/{id}', summary: 'Récupérer un utilisateur par id_user', exampleCurl: `curl -H "x-api-key: <YOUR_API_KEY>" "http://localhost:5173/api/users/<user_id>"` }
    ]
  },

  {
    group: 'API Keys (Administration)',
    description: 'Créer / lister / révoquer des clés API pour usage programmatique sans session web',
    items: [
      { method: 'GET', path: '/api/admin/api-keys', summary: 'Lister les clés API (admin)', exampleCurl: `curl -H "Cookie: current_user_id=<SIGNED_COOKIE>" http://localhost:5173/api/admin/api-keys` },
      { method: 'POST', path: '/api/admin/api-keys', summary: 'Créer une clé API (admin) — retourne la clé brute une seule fois', exampleCurl: `curl -X POST -H "Content-Type: application/json" -H "Cookie: current_user_id=<SIGNED_COOKIE>" -d '{"label":"service1","scopes":["read"]}' http://localhost:5173/api/admin/api-keys` },
      { method: 'DELETE', path: '/api/admin/api-keys/{id}', summary: 'Révoquer une clé (admin)', exampleCurl: `curl -X DELETE -H "Cookie: current_user_id=<SIGNED_COOKIE>" http://localhost:5173/api/admin/api-keys/123` }
    ]
  },

  {
    group: 'External uploads',
    description: 'Endpoints pensés pour les services externes (protégés par API Key)',
    items: [
      { method: 'POST', path: '/api/external/media', summary: 'Uploader un fichier via API Key', exampleCurl: `curl -X POST -H "x-api-key: <YOUR_API_KEY>" -F 'file=@photo.jpg' http://localhost:5173/api/external/media` },
      { method: 'GET', path: '/api/external/media', summary: 'Lister les médias externes (API Key)', exampleCurl: `curl -H "x-api-key: <YOUR_API_KEY>" http://localhost:5173/api/external/media` }
    ]
  }
];

export default API_ENDPOINTS;
