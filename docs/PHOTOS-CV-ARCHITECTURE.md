# Photos CV - Architecture avec Album

## Vue d'ensemble

Le système Photos CV a été repensé pour utiliser un **album Immich caché** au lieu des tags `[PhotoCV]` dans les descriptions. Cette approche est beaucoup plus performante et scalable.

## Architecture

### Album système "PhotoCV"

- **Nom**: `PhotoCV`
- **Type**: Album Immich standard (mais utilisé comme album système)
- **Description**: "Album système pour les photos CV (géré automatiquement)"
- **Création**: Automatique au premier appel de l'API
- **Visibilité**: Caché pour les utilisateurs finaux (géré uniquement via les endpoints)

### Endpoints API

#### GET `/api/photos-cv`

Récupère des photos selon différentes actions :

**Action: `my-photos`**
```
GET /api/photos-cv?action=my-photos&personId={id}
```
Retourne les photos de la personne **HORS** de l'album PhotoCV (photos normales).

**Action: `album-photos`**
```
GET /api/photos-cv?action=album-photos&personId={id}
```
Retourne les photos de la personne **DANS** l'album PhotoCV (photos CV).

**Action: `album-info`**
```
GET /api/photos-cv?action=album-info
```
Retourne les informations sur l'album PhotoCV (ID, nom, nombre de photos).

#### POST `/api/photos-cv`

Gère l'ajout/suppression de photos dans l'album :

**Action: `add-to-album`**
```json
POST /api/photos-cv
{
  "action": "add-to-album",
  "assetIds": ["asset-id-1", "asset-id-2"]
}
```

**Action: `remove-from-album`**
```json
POST /api/photos-cv
{
  "action": "remove-from-album",
  "assetIds": ["asset-id-1", "asset-id-2"]
}
```

### Performances

**Avant (avec tags [PhotoCV])** :
- ❌ Recherche globale : 10 000+ requêtes HTTP
- ❌ Parsing de description pour chaque photo
- ❌ Temps de chargement : 30-60 secondes

**Après (avec album)** :
- ✅ 1 requête pour récupérer l'album
- ✅ Filtrage côté serveur
- ✅ Temps de chargement : < 2 secondes
- ✅ Cache de l'ID d'album (TTL 1 minute)

## Utilisation

### Page "Mes photos" (`/mes-photos`)

Affiche les photos de la personne **HORS** de l'album PhotoCV.

```typescript
// Charge automatiquement les photos normales
photosState.loadPerson(personId);
```

### Page "Photos CV" (`/photos-cv`)

**Onglet "Mes photos CV"** :
```typescript
// Charge les photos de la personne DANS l'album PhotoCV
myPhotosState.loadAll(personId);
```

**Onglet "Toutes les photos CV"** (admin/mitviste) :
```typescript
// Charge toutes les photos de l'album PhotoCV
// (en fait juste les photos de la personne admin dans l'album)
allPhotosState.loadAll(personId);
```

### Upload de photos CV

```typescript
// 1. Upload les fichiers
const uploadRes = await fetch('/api/immich/assets', {
  method: 'POST',
  body: formData
});

// 2. Ajouter automatiquement à l'album PhotoCV
await fetch('/api/photos-cv', {
  method: 'POST',
  body: JSON.stringify({
    action: 'add-to-album',
    assetIds: uploadedAssetIds
  })
});

// 3. Recharger les vues
await myPhotosState.loadPerson(personId);
await allPhotosState.loadAll(personId);
```

## Migration des anciennes données

Un script de migration automatique est fourni pour déplacer toutes les photos avec le tag `[PhotoCV]` vers le nouvel album :

```bash
# Avec les variables d'environnement du projet
cd scripts
node migrate-photocv.cjs
```

Le script :
1. ✅ Crée l'album PhotoCV s'il n'existe pas
2. ✅ Recherche toutes les images avec `[PhotoCV]` dans la description
3. ✅ Les ajoute à l'album PhotoCV par batches de 100
4. ✅ Affiche la progression en temps réel

**Note** : Les tags `[PhotoCV]` dans les descriptions peuvent être supprimés manuellement après la migration si souhaité.

## Prochaines étapes

1. **Généraliser cette approche** :
   - Créer `/api/immich-proxy/` pour centraliser tous les appels Immich
   - Ajouter un système de cache global
   - Meilleure gestion des erreurs

2. **Améliorer la gestion des permissions** :
   - Vérifier les droits utilisateur dans les endpoints
   - Empêcher les non-admins d'ajouter des photos d'autres personnes

3. **Interface d'administration** :
   - Voir toutes les photos de l'album PhotoCV
   - Déplacer des photos entre album et photos normales
   - Statistiques et rapports

## Structure du code

```
src/
  routes/
    api/
      photos-cv/
        +server.ts          # Endpoint principal (GET + POST)
    photos-cv/
      +page.svelte          # Interface utilisateur
    mes-photos/
      +page.svelte          # Photos normales (hors album)
  lib/
    photos.svelte.ts        # État et logique métier
      - loadPerson()        # Photos HORS album
      - loadAll()           # Photos DANS album
scripts/
  migrate-photocv.cjs       # Script de migration
```

## FAQ

**Q: Que se passe-t-il si quelqu'un supprime l'album PhotoCV ?**  
R: Il sera automatiquement recréé au prochain appel de l'API.

**Q: Peut-on avoir plusieurs albums PhotoCV ?**  
R: Non, un seul album avec le nom "PhotoCV" est utilisé. Le système le recherche par nom.

**Q: Les photos sont-elles dupliquées ?**  
R: Non, Immich utilise des références. Une photo peut être dans plusieurs albums sans duplication.

**Q: Comment retirer une photo de l'album PhotoCV ?**  
R: Utiliser l'endpoint `POST /api/photos-cv` avec `action: "remove-from-album"`.
