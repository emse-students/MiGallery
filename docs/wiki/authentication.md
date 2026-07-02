# Authentication and authorization

MiGallery authenticates through **Authentik** (the shared MiConnect instance) via
OpenID Connect, and authorizes each API call with a scope model backed by either
the session or an API key.

## Login flow (OIDC)

The routes live under `src/routes/api/auth/`:

- **`GET /api/auth/login`** starts the OIDC flow (redirect to Authentik).
- **`GET /api/auth/callback`** handles the return: it resolves the Authentik
  identity to a local `users` row (matched by the OIDC `sub` stored as
  `id_user`), and sets the session cookie.
- **`GET /api/auth/logout`** clears the session.

Claims used: `sub` (the stable user id), name, `promo`, `formation`. A user's
role is **not** taken from the SSO; it is stored locally (`users.role`) so it is
never escalated by a login. On first login, `users.first_login = 1` triggers the
promo/formation modal (`FirstLoginModal`), after which it is set to 0.

## Session cookies

Two cookies can carry identity; `getCurrentUser`/`ensureAdmin`
(`src/lib/server/auth.ts`) consult them in this order:

1. **`current_user_id`** - a **signed** cookie (`$lib/auth/cookies`
   `signSigned`/`verifySigned`). When present it is the single source of truth:
   even the provider identity is ignored, so an admin who impersonates a
   non-admin genuinely drops admin rights (see impersonation below).
2. **`__session_user`** - a plain cookie holding the user id, set at login by
   `setSessionCookie` (`src/lib/session.ts`), 1-year max-age, httpOnly.
3. **`locals.user`** - populated by the session hook from `__session_user`, used
   as the final fallback.

Each resolves to a `users` row by `id_user`. `hooks.server.ts` also strips
legacy-format `current_user_id` cookies (old short `prenom.nom` values) so they
cannot linger.

## Roles

`users.role` is one of:

- **`admin`** - full access, including `/admin/*` and admin API scope.
- **`mitviste`** - admin-like (MiTV staff).
- **`user`** - default.

Role is local and authoritative; the SSO cannot change it.

## Scopes and the permission helpers

`src/lib/server/permissions.ts` centralizes authorization. Every protected API
handler calls one of:

- **`requireScope(event, scope, opts?)`** - the main gate. `scope` is one of
  `public | read | write | admin`. It accepts EITHER a session OR an `x-api-key`
  header:
  - `public` returns immediately (no auth).
  - With an API key: the raw key is verified against the requested scope
    (`verifyRawKeyWithScope`), with the natural hierarchy `admin > write > read`.
    Non-GET or admin-scope key usage is logged.
  - With a session: `getCurrentUser` must resolve a user (else 401); `admin`
    additionally requires `ensureAdmin` (else 403). `allowSelf` + `targetUserId`
    lets a user act on their own resource at `write` level without being admin.
  - Returns `{ user, grantedScope, viaApiKey }`.
- **`requireSession(event)`** - session only (no API key), returns the `UserRow`.
- **`requireAdminSession(event)`** - admin session only.

## API keys

For external/server-to-server access (`/api/external/*`, scripts, other apps).
Keys are stored **hashed** in the `api_keys` table (`key_hash`, `label`,
`scopes`, `revoked`, `created_at`) and managed under `/admin/api-keys`. A key
carries one or more scopes; an `admin`-scoped key can reach every admin endpoint.
Presented via the `x-api-key` (or `X-API-KEY`) header. Usage is audit-logged.

## Impersonation

Admins can act as another user (the `change-user` endpoint / admin UI). This sets
the signed `current_user_id` cookie, which - because it is checked first and
overrides the provider identity - makes the whole app behave as that user,
including dropping admin rights when impersonating a non-admin. Clearing it
returns the admin to their own identity.
