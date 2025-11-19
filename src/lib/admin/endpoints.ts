export const API_ENDPOINTS = [
  {
    group: 'Albums',
    description: 'Endpoints pour lire et modifier les albums (proxy Immich + local additions)',
    items: [
      { method: 'GET', path: '/api/albums', summary: 'Lister les albums', exampleCurl: `curl "http://localhost:5173/api/albums"` },
      { method: 'GET', path: '/api/albums/{id}', summary: 'Détails d\'un album', exampleCurl: `curl "http://localhost:5173/api/albums/ALBUM_ID"` },
      { method: 'GET', path: '/api/albums/{id}/info', summary: 'Infos d\'un album (métadonnées locales + Immich)', exampleCurl: `curl "http://localhost:5173/api/albums/ALBUM_ID/info"`, notes: 'Retourne le nom, date, location, visibility, tags et utilisateurs autorisés.' },
      { method: 'GET', path: '/api/albums/{id}/assets-stream', summary: 'Stream des assets d\'un album (NDJSON)', exampleCurl: `curl "http://localhost:5173/api/albums/ALBUM_ID/assets-stream"`, notes: 'Streaming progressif en NDJSON. Chaque ligne: {"phase":"minimal"|"full", "asset":{...}}' },
      { method: 'POST', path: '/api/albums', summary: 'Créer un album (dans Immich et BDD locale)', exampleCurl: `curl -X POST -H "Content-Type: application/json" -d '{"albumName":"Mon Album","date":"2025-11-19","location":"Saint-Étienne","visibility":"private","visible":true}' "http://localhost:5173/api/albums"`, notes: 'Crée l\'album dans Immich puis l\'enregistre dans la base locale avec ses métadonnées (date, location, visibility, visible)' },
      { method: 'DELETE', path: '/api/albums/{id}', summary: 'Supprimer un album', exampleCurl: `curl -X DELETE "http://localhost:5173/api/albums/ALBUM_ID"` }
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
        exampleCurl: `curl "http://localhost:5173/api/immich/assets?size=thumbnail"`,
        notes: 'Cette route proxie Immich directement.'
      },
      {
        method: 'GET',
        path: '/api/immich/assets/{id}/thumbnail',
        summary: 'Récupérer la vignette d\'un asset',
        params: [{ name: 'id', in: 'path', desc: 'Immich asset id (UUID)' }],
        exampleCurl: `curl "http://localhost:5173/api/immich/assets/ASSET_ID/thumbnail?size=thumbnail"`,
      },
      {
        method: 'GET',
        path: '/api/immich/assets/{id}/original',
        summary: 'Récupérer la ressource originale (proxy)',
        exampleCurl: `curl "http://localhost:5173/api/immich/assets/ASSET_ID/original"`,
      }
    ]
  },

  {
    group: 'People & Photos-CV',
    description: 'Endpoints pour les personnes reconnues et l\'album système PhotoCV',
    items: [
      { method: 'GET', path: '/api/people/people', summary: 'Lister toutes les personnes reconnues par Immich', exampleCurl: `curl "http://localhost:5173/api/people/people"` },
      { method: 'GET', path: '/api/people/people/{personId}/photos', summary: 'Photos d\'une personne (non PhotoCV)', exampleCurl: `curl "http://localhost:5173/api/people/people/PERSON_ID/photos"` },
      { method: 'GET', path: '/api/people/people/{personId}/photos-stream', summary: 'Stream des photos d\'une personne (NDJSON)', exampleCurl: `curl "http://localhost:5173/api/people/people/PERSON_ID/photos-stream"` },
      { method: 'GET', path: '/api/people/person/{id}/my-photos', summary: 'Mes photos (exclut system albums)', exampleCurl: `curl "http://localhost:5173/api/people/person/USER_ID/my-photos"` },
      { method: 'GET', path: '/api/people/person/{id}/album-photos', summary: 'Photos de la personne dans l\'album PhotoCV', exampleCurl: `curl "http://localhost:5173/api/people/person/USER_ID/album-photos"` },
      { method: 'GET', path: '/api/people/album/{albumId}/assets', summary: 'Lister les assets d\'un album PhotoCV', exampleCurl: `curl "http://localhost:5173/api/people/album/ALBUM_ID/assets"` },
      { method: 'PUT', path: '/api/people/album/assets', summary: 'Ajouter des assets à l\'album PhotoCV (body: { assetIds: [] })', exampleCurl: `curl -X PUT -H "Content-Type: application/json" -d '{"assetIds":["id1","id2"]}' http://localhost:5173/api/people/album/assets` },
      { method: 'DELETE', path: '/api/people/album/assets', summary: 'Retirer des assets de l\'album PhotoCV (body: { assetIds: [] })', exampleCurl: `curl -X DELETE -H "Content-Type: application/json" -d '{"assetIds":["id1"]}' http://localhost:5173/api/people/album/assets` }
    ]
  },

  {
    group: 'Users',
    description: 'Gestion des utilisateurs locaux et profils',
    items: [
      { method: 'GET', path: '/api/users', summary: 'Lister tous les utilisateurs (admin only)', exampleCurl: `curl -H "Authorization: Bearer <SESSION_COOKIE>" http://localhost:5173/api/users`, noteAuth: 'Cet endpoint nécessite des privilèges admin.' },
      { method: 'GET', path: '/api/users/{id}', summary: 'Récupérer un utilisateur par id_user', exampleCurl: `curl "http://localhost:5173/api/users/USER_ID"` },
      { method: 'GET', path: '/api/users/{id_user}/avatar', summary: 'Photo de profil d\'un utilisateur (par id_user)', exampleCurl: `curl -H "Cookie: current_user_id=<SESSION>" "http://localhost:5173/api/users/jolan.boudin/avatar"`, noteAuth: 'Authentification requise (session cookie ou auth provider). L\'utilisateur doit avoir un id_photos configuré.' }
    ]
  },

  {
    group: 'API Keys (Administration)',
    description: 'Créer / lister / révoquer des clés API pour usage programmatique sans session web',
    items: [
      { method: 'GET', path: '/api/admin/api-keys', summary: 'Lister les clés API (admin)', exampleCurl: `curl -H "Cookie: current_user_id=<SIGNED_COOKIE>" http://localhost:5173/api/admin/api-keys` },
      { method: 'POST', path: '/api/admin/api-keys', summary: 'Créer une clé API (admin) — retourne la clé brute une seule fois', exampleCurl: `curl -X POST -H "Content-Type: application/json" -H "Cookie: current_user_id=<SIGNED_COOKIE>" -d '{"label":"service1","scopes":["read"]}' http://localhost:5173/api/admin/api-keys` },
      { method: 'DELETE', path: '/api/admin/api-keys/{id}', summary: 'Révoquer une clé (admin)', exampleCurl: `curl -X DELETE -H "Cookie: current_user_id=<SIGNED_COOKIE>" http://localhost:5173/api/admin/api-keys/ID` }
    ]
  },

  {
    group: 'External uploads',
    description: 'Endpoints pensés pour les services externes (protégés par API Key)',
    items: [
      { method: 'POST', path: '/api/external/media', summary: 'Uploader un fichier via API Key', exampleCurl: `curl -X POST -H "x-api-key: <YOUR_API_KEY>" -F 'file=@photo.jpg' http://localhost:5173/api/external/media` },
      { method: 'GET', path: '/api/external/media', summary: 'Lister les médias externes (API Key)', exampleCurl: `curl -H "x-api-key: <YOUR_API_KEY>" http://localhost:5173/api/external/media` }
    ]
  },

  {
    group: 'Health & Misc',
    description: 'Endpoints utilitaires et vérifications',
    items: [
      { method: 'GET', path: '/api/health', summary: 'Vérifier que le serveur est actif', exampleCurl: `curl "http://localhost:5173/api/health"`, notes: 'Retourne { status: "ok" }' },
      { method: 'POST', path: '/api/change-user', summary: 'Changer l\'utilisateur actuel (dev only)', exampleCurl: `curl -X POST -H "Content-Type: application/json" -d '{"username":"autre.user"}' http://localhost:5173/api/change-user"`, noteAuth: 'Endpoint de développement, désactivé en production.' }
    ]
  }
];

export default API_ENDPOINTS;
