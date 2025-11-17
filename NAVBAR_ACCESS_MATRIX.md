# Matrice d'accès à la barre de navigation - MiGallery

## Visibilité de la navbar selon le contexte

### Page d'accueil (`/`)
- **Navbar complète** : **MASQUÉE** (sauf logo + bouton connexion/avatar)
- **Raison** : Design épuré pour la landing page

### Toutes les autres pages
- **Navbar complète** : **VISIBLE**

---

## Permissions par rôle et conditions

### Type d'utilisateur
1. **Non authentifié** (visiteur)
2. **Utilisateur standard** (`role = 'user'`)
3. **MiTViste** (`role = 'mitviste'`)
4. **Admin** (`role = 'admin'`)

### Conditions supplémentaires
- `hasPhoto` = utilisateur a un `id_photos` (présent dans Immich)

---

## Matrice de visibilité des liens navbar

| Lien / Bouton | Non auth | User | User + hasPhoto | MiTViste | MiTViste + hasPhoto | Admin | Admin + hasPhoto |
|---------------|----------|------|-----------------|----------|---------------------|-------|------------------|
| **Logo MiGallery** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Albums** | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Mes photos** | ❌ | ❌ | ✅ | ❌ | ✅ | ❌ | ✅ |
| **Photos CV** | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Trombinoscope** | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| **Corbeille** | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ |
| **Paramètres** | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Avatar/Nom** | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Déconnexion** | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Connexion** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

**Note importante** : Admin et MiTViste ont accès à "Photos CV" même **sans** `id_photos`, mais dans ce cas :
- L'onglet "Mes photos CV" est masqué
- Seul l'onglet "Toutes les photos CV" est affiché (pour gérer les imports)


---

## Logique actuelle dans `+layout.svelte`

```typescript
let isAuthenticated = $derived(!!u);
let isAdmin = $derived(u?.role === 'admin');
let isMitviste = $derived(u?.role === 'mitviste');
let canManagePhotos = $derived(isAdmin || isMitviste);
let hasPhoto = $derived(!!u?.id_photos);
let isHomePage = $derived(page.url.pathname === '/');
```

### Conditions d'affichage des liens

```typescript
// Navbar complète visible pour tous les utilisateurs authentifiés (y compris sur /)
{#if isAuthenticated}
  
  // Section gauche
  <a href="/albums">Albums</a>
  
  {#if hasPhoto}
    <a href="/mes-photos">Mes photos</a>
  {/if}
  
  {#if hasPhoto || canManagePhotos}
    <a href="/photos-cv">Photos CV</a>
  {/if}
  
  // Section droite
  {#if isAdmin}
    <a href="/trombinoscope">Trombinoscope</a>
  {/if}
  
  {#if canManagePhotos}
    <a href="/corbeille">Corbeille</a>
  {/if}
  
  <a href="/parametres">Paramètres</a>
  
{/if}
```

---

## Protection des pages (server-side)

| Page | Protection | Méthode actuelle | Problème ? |
|------|-----------|------------------|------------|
| `/` | Public | Aucune | ✅ OK |
| `/albums` | `isAuthenticated` | ❌ `locals.auth()` direct | 🔴 **BUG** - bypass cookie |
| `/albums/[id]` | `isAuthenticated` | ❌ `locals.auth()` direct | 🔴 **BUG** - bypass cookie |
| `/mes-photos` | `isAuthenticated` | ✅ `await parent()` | ✅ OK |
| `/photos-cv` | `isAuthenticated` + (`hasPhoto` OR `canManagePhotos`) | ✅ `await parent()` | ✅ OK |
| `/trombinoscope` | `isAdmin` | ❌ `locals.auth()` direct | 🔴 **BUG** - bypass cookie |
| `/corbeille` | Aucune | Aucune | ⚠️ Devrait être protégé |
| `/parametres` | `isAuthenticated` | ✅ `await parent()` | ✅ OK |
| `/admin/*` | `isAdmin` | ✅ `ensureAdmin()` | ✅ OK |

---

## Bugs identifiés

### 🔴 Bug 1 : Pages qui bypass le cookie signé
**Pages concernées** :
- `/albums/+page.server.ts`
- `/albums/[id]/+page.server.ts`
- `/trombinoscope/+page.server.ts`

**Problème** : Utilisent `locals.auth()` directement au lieu de `await parent()`, ce qui :
- Bypass le système de cookie signé
- Ne fonctionne pas en dev avec `/dev/login-as`
- Requiert une session provider active (CAS) à chaque fois

**Solution** : Remplacer par `await parent()` pour récupérer la session du layout parent.

### 🔴 Bug 2 : Page corbeille non protégée
**Page concernée** : `/corbeille/+page.svelte`

**Problème** : Aucune protection server-side, alors qu'elle devrait être accessible uniquement aux admins/mitvistes.

**Solution** : Ajouter un `+page.server.ts` avec protection `canManagePhotos`.

### 🔴 Bug 3 : Liens navbar masqués sur page d'accueil (même pour admin)
**Contexte** : Sur la page d'accueil, TOUTE la navbar est masquée (sauf logo + avatar).

**Problème rapporté** : "les boutons de la page navigation ne sont toujours pas accessibles sur la page d'accueil"

**Question design** : 
- Faut-il **toujours** masquer les liens sur `/` ?
- Ou faut-il les afficher pour les utilisateurs authentifiés ?

**Options** :
1. **Garder l'état actuel** : masqué sur `/` pour tout le monde (design épuré)
2. **Afficher pour authentifiés** : `{#if !isHomePage || isAuthenticated}` 
3. **Toujours afficher** : supprimer la condition `!isHomePage`

---

## Recommandations

### Corrections immédiates
1. ✅ Corriger les 3 pages qui utilisent `locals.auth()` → `await parent()`
2. ✅ Ajouter protection server-side à `/corbeille`
3. ⚠️ Décider du comportement navbar sur page d'accueil

### Améliorations futures
- Centraliser les checks de permission dans un helper réutilisable
- Ajouter des tests E2E pour chaque rôle
- Documenter les permissions dans le code (JSDoc)

---

## Tests manuels recommandés

Après corrections, tester avec chaque rôle :

### En tant que visiteur (non auth)
- [ ] Page d'accueil accessible
- [ ] Navbar minimale (logo + bouton connexion)
- [ ] Toutes les autres pages redirigent vers `/`

### En tant que `user` (sans photo)
- [ ] Peut accéder : `/albums`, `/parametres`
- [ ] Ne peut PAS accéder : `/mes-photos`, `/photos-cv`, `/trombinoscope`, `/corbeille`
- [ ] Navbar affiche : Albums, Paramètres

### En tant que `user` (avec photo)
- [ ] Peut accéder : `/albums`, `/mes-photos`, `/photos-cv`, `/parametres`
- [ ] Navbar affiche : Albums, Mes photos, Photos CV, Paramètres

### En tant que `mitviste`
- [ ] Peut accéder : tout sauf `/trombinoscope`
- [ ] Navbar affiche : Albums, Mes photos*, Photos CV*, Corbeille, Paramètres
- [ ] (*si hasPhoto)

### En tant que `admin`
- [ ] Peut accéder : toutes les pages
- [ ] Navbar affiche : tout
- [ ] `/admin/*` accessible

---

## Code de référence : dérivées navbar

```typescript
// Dans +layout.svelte
let u = $derived((page.data?.session?.user) as any);
let isAdmin = $derived(u?.role === 'admin');
let isMitviste = $derived(u?.role === 'mitviste');
let canManagePhotos = $derived(isAdmin || isMitviste);
let hasPhoto = $derived(!!u?.id_photos);
let isAuthenticated = $derived(!!u);
let isHomePage = $derived(page.url.pathname === '/');
```

Ces dérivées sont calculées à partir de `page.data.session.user` qui est chargé dans `+layout.server.ts` via :
1. Cookie signé (fast-path)
2. Fallback provider session
3. Création auto si premier login
