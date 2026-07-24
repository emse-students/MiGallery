# MiGallery Navigation Bar Access Matrix

## Navbar visibility by context

### Home page (`/`)

- **Full Navbar**: **HIDDEN** (except logo + login/avatar button)
- **Reason**: Clean design for the landing page

### All other pages

- **Full Navbar**: **VISIBLE**

---

## Permissions by role and conditions

### User type

1. **Not authenticated** (visitor)
2. **Standard user** (`role = 'user'`)
3. **MiTViste** (`role = 'mitviste'`)
4. **Admin** (`role = 'admin'`)

### Additional conditions

- `hasPhoto` = user has a `photos_id` (present in Immich)

---

## Navbar link visibility matrix

| Link / Button      | Non auth | User | User + hasPhoto | MiTViste | MiTViste + hasPhoto | Admin | Admin + hasPhoto |
| ------------------ | -------- | ---- | --------------- | -------- | ------------------- | ----- | ---------------- |
| **MiGallery Logo** | ✅       | ✅   | ✅              | ✅       | ✅                  | ✅    | ✅               |
| **Albums**         | ❌       | ✅   | ✅              | ✅       | ✅                  | ✅    | ✅               |
| **My photos**      | ❌       | ❌   | ✅              | ❌       | ✅                  | ❌    | ✅               |
| **CV Photos**      | ❌       | ❌   | ✅              | ✅       | ✅                  | ✅    | ✅               |
| **Directory**      | ❌       | ❌   | ❌              | ❌       | ❌                  | ✅    | ✅               |
| **Trash**          | ❌       | ❌   | ❌              | ✅       | ✅                  | ✅    | ✅               |
| **Settings**       | ❌       | ✅   | ✅              | ✅       | ✅                  | ✅    | ✅               |
| **Avatar/Name**    | ❌       | ✅   | ✅              | ✅       | ✅                  | ✅    | ✅               |
| **Sign out**       | ❌       | ✅   | ✅              | ✅       | ✅                  | ✅    | ✅               |
| **Sign in**        | ✅       | ❌   | ❌              | ❌       | ❌                  | ❌    | ❌               |

**Important note**: Admin and MiTViste have access to "CV Photos" even **without** `photos_id`, but in this case:

- The "My CV photos" tab is hidden
- Only the "All CV photos" tab is displayed (to manage imports)

---

## Current logic in `+layout.svelte`

```typescript
let isAuthenticated = $derived(!!u);
let isAdmin = $derived(u?.role === 'admin');
let isMitviste = $derived(u?.role === 'mitviste');
let canManagePhotos = $derived(isAdmin || isMitviste);
let hasPhoto = $derived(!!u?.photos_id);
let isHomePage = $derived(page.url.pathname === '/');
```

### Link display conditions

```typescript
// Full navbar visible for all authenticated users (including on /)
{#if isAuthenticated}

  // Left section
  <a href="/albums">Albums</a>

  {#if hasPhoto}
    <a href="/mes-photos">My photos</a>
  {/if}

  {#if hasPhoto || canManagePhotos}
    <a href="/photos-cv">CV Photos</a>
  {/if}

  // Right section
  {#if isAdmin}
    <a href="/trombinoscope">Directory</a>
  {/if}

  {#if canManagePhotos}
    <a href="/corbeille">Trash</a>
  {/if}

  <a href="/parametres">Settings</a>

{/if}
```

---

## Page protection (server-side)

| Page             | Protection                                            | Current method            | Issue?                     |
| ---------------- | ----------------------------------------------------- | ------------------------- | -------------------------- |
| `/`              | Public                                                | None                      | ✅ OK                      |
| `/albums`        | `isAuthenticated`                                     | ❌ `locals.auth()` direct | 🔴 **BUG** - bypass cookie |
| `/albums/[id]`   | `isAuthenticated`                                     | ❌ `locals.auth()` direct | 🔴 **BUG** - bypass cookie |
| `/mes-photos`    | `isAuthenticated`                                     | ✅ `await parent()`       | ✅ OK                      |
| `/photos-cv`     | `isAuthenticated` + (`hasPhoto` OR `canManagePhotos`) | ✅ `await parent()`       | ✅ OK                      |
| `/trombinoscope` | `isAdmin`                                             | ❌ `locals.auth()` direct | 🔴 **BUG** - bypass cookie |
| `/corbeille`     | None                                                  | None                      | ⚠️ Should be protected     |
| `/parametres`    | `isAuthenticated`                                     | ✅ `await parent()`       | ✅ OK                      |
| `/admin/*`       | `isAdmin`                                             | ✅ `ensureAdmin()`        | ✅ OK                      |

---

## Identified bugs

### 🔴 Bug 1: Pages that bypass the signed cookie

**Concerned pages**:

- `/albums/+page.server.ts`
- `/albums/[id]/+page.server.ts`
- `/trombinoscope/+page.server.ts`

**Problem**: Use `locals.auth()` directly instead of `await parent()`, which:

- Bypasses the signed cookie system
- Does not work in dev with `/dev/login-as`
- Requires an active session provider (CAS) every time

**Solution**: Replace with `await parent()` to retrieve the session from the parent layout.

### 🔴 Bug 2: Trash page not protected

**Concerned page**: `/corbeille/+page.svelte`

**Problem**: No server-side protection, although it should only be accessible to admins/mitvistes.

**Solution**: Add a `+page.server.ts` with `canManagePhotos` protection.

### 🔴 Bug 3: Navbar links hidden on home page (even for admin)

**Context**: On the home page, ALL navbar is hidden (except logo + avatar).

**Reported issue**: "the navigation page buttons are still not accessible on the home page"

**Design question**:

- Should links **always** be hidden on `/`?
- Or should they be shown for authenticated users?

**Options**:

1. **Keep current state**: hidden on `/` for everyone (clean design)
2. **Show for authenticated users**: `{#if !isHomePage || isAuthenticated}`
3. **Always show**: remove the `!isHomePage` condition

---

## Recommendations

### Immediate fixes

1. ✅ Fix the 3 pages that use `locals.auth()` → `await parent()`
2. ✅ Add server-side protection to `/corbeille`
3. ⚠️ Decide on navbar behavior on the home page

### Future improvements

- Centralize permission checks in a reusable helper
- Add E2E tests for each role
- Document permissions in code (JSDoc)

---

## Recommended manual tests

After fixes, test with each role:

### As visitor (non auth)

- [ ] Home page accessible
- [ ] Minimal navbar (logo + login button)
- [ ] All other pages redirect to `/`

### As `user` (without photo)

- [ ] Can access: `/albums`, `/parametres`
- [ ] Cannot access: `/mes-photos`, `/photos-cv`, `/trombinoscope`, `/corbeille`
- [ ] Navbar shows: Albums, Settings

### As `user` (with photo)

- [ ] Can access: `/albums`, `/mes-photos`, `/photos-cv`, `/parametres`
- [ ] Navbar shows: Albums, My photos, CV Photos, Settings

### As `mitviste`

- [ ] Can access: everything except `/trombinoscope`
- [ ] Navbar shows: Albums, My photos*, CV Photos*, Trash, Settings
- [ ] (\*if hasPhoto)

### As `admin`

- [ ] Can access: all pages
- [ ] Navbar shows: everything
- [ ] `/admin/*` accessible

---

## Reference code: navbar derived values

```typescript
// In +layout.svelte
let u = $derived(page.data?.session?.user as any);
let isAdmin = $derived(u?.role === 'admin');
let isMitviste = $derived(u?.role === 'mitviste');
let canManagePhotos = $derived(isAdmin || isMitviste);
let hasPhoto = $derived(!!u?.photos_id);
let isAuthenticated = $derived(!!u);
let isHomePage = $derived(page.url.pathname === '/');
```

These derived values are computed from `page.data.session.user` which is loaded in `+layout.server.ts` via:

1. Signed cookie (fast-path)
2. Fallback provider session
3. Auto-creation if first login
