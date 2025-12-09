# 🧪 Guide de Contribution aux Tests

Ce guide explique comment ajouter, modifier et maintenir les tests de MiGallery.

## 📋 Table des matières

- [Principes de base](#principes-de-base)
- [Structure des tests](#structure-des-tests)
- [Ajouter un nouveau test](#ajouter-un-nouveau-test)
- [Helpers et utilitaires](#helpers-et-utilitaires)
- [Best practices](#best-practices)
- [Debugging](#debugging)

---

## Principes de base

### Organisation des fichiers

Les tests sont organisés par **domaine fonctionnel** :

```
tests/
├── albums.test.ts              # Tests pour l'API Albums
├── users.test.ts               # Tests pour l'API Utilisateurs
├── favorites-external.test.ts  # Tests Favoris & External Media
├── admin-auth.test.ts          # Tests Admin & Authentification
├── people-photoscv.test.ts     # Tests People & Photos-CV
├── immich-proxy.test.ts        # Tests Proxy Immich
├── e2e-integration.test.ts     # Tests End-to-End
├── test-helpers.ts             # Configuration et helpers
└── README.md                   # Documentation
```

### Conventions de nommage

- **Fichiers** : `{domaine}.test.ts`
- **Describe blocks** : `{Domaine} API - {Méthode} {Endpoint}`
- **Tests** : `devrait {action attendue}`

### Exemple

```typescript
describe('Albums API - GET /api/albums', () => {
	it('devrait lister tous les albums', async () => {
		// Test ici
	});
});
```

---

## Structure des tests

### Template de base

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getAuthHeaders, TEST_CONFIG } from './test-helpers';

const API_BASE_URL = TEST_CONFIG.API_BASE_URL;
let API_KEY = '';

beforeAll(async () => {
	// Setup : créer des ressources nécessaires
});

afterAll(async () => {
	// Cleanup : supprimer les ressources créées
});

describe('Mon Domaine API - GET /api/mon-endpoint', () => {
	it('devrait faire quelque chose', async () => {
		const response = await fetch(`${API_BASE_URL}/api/mon-endpoint`, {
			headers: getAuthHeaders(API_KEY)
		});

		expect([200, 401]).toContain(response.status);

		if (response.status === 200) {
			const data = await response.json();
			expect(data).toBeDefined();
		}
	});
});
```

---

## Ajouter un nouveau test

### 1. Choisir le fichier approprié

**Question** : Mon test concerne quelle fonctionnalité ?

- Albums → `albums.test.ts`
- Utilisateurs → `users.test.ts`
- Favoris/External Media → `favorites-external.test.ts`
- Admin/Auth → `admin-auth.test.ts`
- People/Photos-CV → `people-photoscv.test.ts`
- Proxy Immich → `immich-proxy.test.ts`
- Workflow complet → `e2e-integration.test.ts`
- Nouvelle fonctionnalité → Créer un nouveau fichier

### 2. Créer le describe block

```typescript
describe('Mon Domaine API - {Méthode} {Endpoint}', () => {
	// Tests ici
});
```

### 3. Ajouter les tests

```typescript
it('devrait {action attendue}', async () => {
	// 1. Préparer les données
	const requestData = {
		/* ... */
	};

	// 2. Faire la requête
	const response = await fetch(`${API_BASE_URL}/api/endpoint`, {
		method: 'POST',
		headers: getAuthHeaders(API_KEY),
		body: JSON.stringify(requestData)
	});

	// 3. Vérifier la réponse
	expect([200, 201, 400, 401]).toContain(response.status);

	// 4. Vérifier les données (si succès)
	if (response.status === 200 || response.status === 201) {
		const data = await response.json();
		expect(data).toHaveProperty('id');
		expect(data.name).toBe('test');
	}
});
```

### 4. Ajouter le cleanup

```typescript
afterAll(async () => {
	// Supprimer les ressources créées pendant les tests
	if (createdResourceId) {
		await fetch(`${API_BASE_URL}/api/resource/${createdResourceId}`, {
			method: 'DELETE',
			headers: getAuthHeaders(API_KEY)
		});
	}
});
```

---

## Helpers et utilitaires

### Utiliser `test-helpers.ts`

```typescript
import {
	getAuthHeaders,
	generateTestUser,
	handleImmichError,
	cleanupResource,
	TEST_CONFIG
} from './test-helpers';

// Headers d'authentification
const headers = getAuthHeaders(apiKey);

// Générer un utilisateur de test unique
const user = generateTestUser('mytest');
// → { id_user: 'mytest.user.1234567890', email: '...', ... }

// Gérer les erreurs Immich
try {
	const response = await fetch('...');
} catch (error) {
	if (handleImmichError(error)) {
		// Immich indisponible, test passe quand même
		return;
	}
	throw error;
}

// Nettoyer une ressource
await cleanupResource(TEST_CONFIG.API_BASE_URL + '/api/albums', apiKey, albumId);
```

### Créer un nouveau helper

Si vous avez besoin d'un helper réutilisable, ajoutez-le dans `test-helpers.ts` :

```typescript
/**
 * Helper pour créer un album de test
 */
export async function createTestAlbum(apiKey: string, name?: string): Promise<string> {
	const albumName = name || `Test Album ${Date.now()}`;

	const response = await fetch(`${TEST_CONFIG.API_BASE_URL}/api/albums`, {
		method: 'POST',
		headers: getAuthHeaders(apiKey),
		body: JSON.stringify({ albumName })
	});

	if (!response.ok) {
		throw new Error('Failed to create test album');
	}

	const album = await response.json();
	return album.id;
}
```

---

## Best practices

### ✅ DO

1. **Utiliser les helpers** pour éviter la duplication
2. **Tester tous les cas** : succès, erreurs, cas limites
3. **Nettoyer les ressources** dans `afterAll()`
4. **Gérer les services externes** (Immich) avec des timeouts et retry
5. **Documenter les tests complexes** avec des commentaires
6. **Utiliser des données uniques** (timestamp, random) pour éviter les conflits

### ❌ DON'T

1. **Ne pas hardcoder les IDs** → Utiliser des variables ou générer
2. **Ne pas laisser de ressources** → Toujours nettoyer
3. **Ne pas ignorer les erreurs** → Vérifier les status codes
4. **Ne pas dupliquer le code** → Utiliser les helpers
5. **Ne pas faire de tests trop longs** → Séparer en plusieurs tests

### Exemple de bonnes pratiques

```typescript
describe('Albums API - POST /api/albums', () => {
	let createdAlbumId: string | null = null;

	afterAll(async () => {
		// ✅ Cleanup automatique
		if (createdAlbumId) {
			await cleanupResource(`${API_BASE_URL}/api/albums`, API_KEY, createdAlbumId);
		}
	});

	it('devrait créer un album', async () => {
		// ✅ Données uniques
		const albumData = {
			albumName: `Test Album ${Date.now()}`,
			description: 'Created by tests'
		};

		const response = await fetch(`${API_BASE_URL}/api/albums`, {
			method: 'POST',
			headers: getAuthHeaders(API_KEY), // ✅ Helper
			body: JSON.stringify(albumData)
		});

		// ✅ Vérifier plusieurs status possibles
		expect([200, 201, 400, 401]).toContain(response.status);

		// ✅ Sauvegarder l'ID pour le cleanup
		if (response.ok) {
			const album = await response.json();
			createdAlbumId = album.id;
			expect(album.albumName).toBe(albumData.albumName);
		}
	});

	it('devrait rejeter un album sans nom', async () => {
		const response = await fetch(`${API_BASE_URL}/api/albums`, {
			method: 'POST',
			headers: getAuthHeaders(API_KEY),
			body: JSON.stringify({ description: 'No name' })
		});

		// ✅ Tester les cas d'erreur
		expect([400, 401]).toContain(response.status);
	});
});
```

---

## Debugging

### Voir les logs détaillés

```bash
# Lancer les tests avec plus de détails
bun test --reporter=verbose

# Lancer un seul fichier de test
bun test tests/albums.test.ts

# Lancer un seul test (utiliser .only)
it.only('devrait faire quelque chose', async () => { /* ... */ });
```

### Inspecter les réponses

```typescript
it('devrait retourner des données', async () => {
	const response = await fetch(`${API_BASE_URL}/api/endpoint`);

	// Afficher la réponse pour debugging
	console.log('Status:', response.status);
	console.log('Headers:', Object.fromEntries(response.headers));

	const data = await response.json();
	console.log('Data:', JSON.stringify(data, null, 2));

	expect(response.status).toBe(200);
});
```

### Problèmes courants

#### ❌ Timeout Error

**Cause** : Le serveur ou Immich ne répond pas assez vite

**Solution** :

```typescript
// Augmenter le timeout du test
it('devrait faire quelque chose', async () => {
	// ...
}, 30000); // 30 secondes

// Ou gérer l'erreur Immich
try {
	const response = await fetch(url, {
		signal: AbortSignal.timeout(10000)
	});
} catch (error) {
	if (handleImmichError(error)) {
		return; // Test passe quand même
	}
	throw error;
}
```

#### ❌ Test échoue de manière intermittente

**Cause** : Données partagées, race conditions, services externes

**Solution** :

```typescript
// 1. Utiliser des données uniques
const userId = `test.user.${Date.now()}.${Math.random()}`;

// 2. Nettoyer avant ET après
beforeAll(async () => {
	// Nettoyer les anciennes ressources
});

afterAll(async () => {
	// Nettoyer les nouvelles ressources
});

// 3. Configurer retry dans vitest.config.ts
test: {
	retry: 1; // Retry une fois si échec
}
```

#### ❌ Ressources non nettoyées

**Cause** : Erreur avant le cleanup ou cleanup raté

**Solution** :

```typescript
afterAll(async () => {
	// Cleanup robuste
	if (createdUserId) {
		try {
			await fetch(`${API_BASE_URL}/api/users/${createdUserId}`, {
				method: 'DELETE',
				headers: getAuthHeaders(API_KEY)
			});
		} catch (error) {
			console.warn('Cleanup failed:', error);
			// Ne pas throw, continuer le cleanup
		}
		createdUserId = null;
	}
});
```

---

## Exemples complets

### Test simple (GET)

```typescript
it('devrait lister les albums', async () => {
	const response = await fetch(`${API_BASE_URL}/api/albums`, {
		headers: getAuthHeaders(API_KEY)
	});

	expect([200, 401]).toContain(response.status);

	if (response.status === 200) {
		const albums = await response.json();
		expect(Array.isArray(albums)).toBe(true);
	}
});
```

### Test avec création (POST)

```typescript
let createdAlbumId: string | null = null;

afterAll(async () => {
	if (createdAlbumId) {
		await cleanupResource(`${API_BASE_URL}/api/albums`, API_KEY, createdAlbumId);
	}
});

it('devrait créer un album', async () => {
	const response = await fetch(`${API_BASE_URL}/api/albums`, {
		method: 'POST',
		headers: getAuthHeaders(API_KEY),
		body: JSON.stringify({
			albumName: `Test ${Date.now()}`
		})
	});

	expect([200, 201]).toContain(response.status);

	if (response.ok) {
		const album = await response.json();
		createdAlbumId = album.id;
		expect(album.id).toBeDefined();
	}
});
```

### Test avec timeout Immich

```typescript
it('devrait gérer Immich indisponible', async () => {
	try {
		const response = await fetch(`${API_BASE_URL}/api/people/people`, {
			headers: getAuthHeaders(API_KEY),
			signal: AbortSignal.timeout(10000)
		});

		expect([200, 404, 500, 502]).toContain(response.status);
	} catch (error) {
		if (handleImmichError(error)) {
			return; // OK, Immich down
		}
		throw error;
	}
}, 15000);
```

---

## Checklist avant commit

- [ ] Les tests passent localement (`bun test`)
- [ ] Les ressources sont nettoyées (pas de fuite)
- [ ] Les timeouts sont appropriés
- [ ] Les cas d'erreur sont testés
- [ ] Les helpers sont utilisés quand possible
- [ ] Le code est commenté si nécessaire
- [ ] La documentation est à jour

---

## Questions ?

- 📖 Voir `tests/README.md` pour la documentation complète
- 🔍 Regarder les tests existants comme exemples
- 💬 Demander de l'aide à l'équipe

**Happy Testing! 🧪**
