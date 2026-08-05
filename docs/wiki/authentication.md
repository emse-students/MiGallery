# Authentication and authorization

MiGallery authenticates through **Authentik** (the shared MiConnect instance) via
OpenID Connect, and authorizes each API call with a scope model backed by either
the session or an API key.

## Login flow (OIDC)

The routes live under `src/routes/api/auth/`:

- **`GET /api/auth/login`** starts the OIDC flow (redirect to Authentik). It
  accepts `?redirectTo=<in-app path>`, which it parks in the `__oidc_return`
  cookie for the round trip (see below).
- **`GET /api/auth/callback`** handles the return: it resolves the Authentik
  identity to a local `users` row (matched by the OIDC `sub` stored as
  `id_user`), and sets the session cookie.
- **`GET /api/auth/logout`** clears the session.

### Coming back to the page that was asked for

A shared album link opened while logged out used to end on the home page: the
guard answered a bare `redirect(303, '/')` and the requested path was gone. It
now travels with the visitor, through three hops, all validated by
`safeRedirectTarget` (`src/lib/auth-redirect.ts`):

1. the guard bounces to `/?redirectTo=<path>` (`loginBounceTarget`);
2. the sign-in button forwards it to `/api/auth/login?redirectTo=<path>`
   (`loginUrlWithRedirect`), which parks it in the `__oidc_return` cookie -
   httpOnly, 10 minutes, beside `__oidc_state` and `__oidc_nonce`. **No value
   deletes the cookie**, so an abandoned attempt cannot steer the next login;
3. the callback reads it, validates it **again** (the cookie is browser input
   like any other), deletes it, and redirects there instead of `/`.

Two rules the guards encode:

- **Only the anonymous case carries a destination.** A visitor who is logged in
  and simply not allowed (`checkAlbumAccess`, a non-admin under `/admin`) gets a
  plain `/`; giving them a destination would return them to the same refusal
  forever. `requireAdminPage` (`src/lib/server/auth.ts`) is that split for the
  admin pages, and the pages that guard on `parent()` split it inline.
- **A path starting with `/` is not proof it is ours.** `//evil.com` and
  `/\evil.com` both do, and both leave the site; so do control characters in a
  `Location` value, and `/api/auth/*` (a login loop). `tests/auth-redirect.test.ts`
  pins the whole refusal list.

An unlisted album is unaffected: it returns before any auth check, so a public
link never bounces at all.

Claims used: `sub` (the stable user id), name, `promo`, `formation`. A user's
role is **not** taken from the SSO; it is stored locally (`users.role`) so it is
never escalated by a login. On first login, `users.first_login = 1` triggers the
promo/formation modal (`FirstLoginModal`), after which it is set to 0.

## Sessions

**One cookie, and it carries no identity.** `migallery_session` holds a random
opaque token; everything else is a row of the `sessions` table
(`src/lib/db/sessions.ts`), which the server owns:

| column                      | meaning                                                      |
| --------------------------- | ------------------------------------------------------------ |
| `token`                     | what the cookie carries, and the only thing it carries       |
| `id_user`                   | the account that authenticated                               |
| `impersonated_id_user`      | set while that account acts as someone else                  |
| `created_at` / `expires_at` | 7-day lifetime, the same as Sky and the Canari refresh token |

`resolveSession` returns both the **effective** user (the impersonated one when
impersonating) and the **real** one. `getCurrentUser` answers the first,
`getRealUser` the second, and only decisions _about_ an impersonation may use it
(`src/lib/server/auth.ts`). There is no fallback chain: a request either carries
a live session or it is anonymous.

Because the row is ours, a session is revocable: `deleteSession` is what logout
does, deleting a user takes their sessions with it through the foreign key, and
signing an account out everywhere is one `DELETE ... WHERE id_user = ?` away.

> **History.** Until 2026-08 the cookie held the RAW `id_user` and nothing
> verified it, while a second signed cookie (`current_user_id`, HMAC with
> `COOKIE_SECRET`) carried impersonation. Any logged-in user could therefore
> become any other by editing one cookie - the ids being handed out by
> `/api/albums/permissions/options`. Both cookies are now deleted on sight by
> `hooks.server.ts`, and `COOKIE_SECRET` no longer exists: an opaque token needs
> no key, so there is nothing left to leak or to rotate.

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

Admins can act as another user (`/admin/login-as?u=<id>`, the `change-user`
endpoint, the admin UI). It writes `impersonated_id_user` **on the caller's own
session row**, so:

- the whole app behaves as that user, admin rights included - `ensureAdmin`
  judges the effective user, so impersonating a non-admin genuinely drops them;
- stopping is authorised on the session's REAL user
  (`canStopImpersonating`), which the client cannot influence - the previous
  design had to guess this from a second signed cookie;
- an impersonation cannot outlive the session that authorised it, so logging out
  ends it; and
- the audit log (`logEvent`) records the REAL account, because that is who acted.
