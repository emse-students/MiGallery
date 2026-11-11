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
never escalated by a login.

**Nothing but the SSO writes `promo`.** A `FirstLoginModal` used to ask the user
for their own graduation year whenever the claim was missing, gated on a
`users.first_login` column. It was deleted, column included: Authentik describes
277 of the 280 accounts on prod, and for the school staff it does not describe,
the modal wrote NULL over NULL - its only effect was to stop showing itself. It
was also the one place a user could **choose** a promo, and a promo is an
album-access key (see [albums-and-permissions](albums-and-permissions.md)).

**The row is a copy, not a second opinion.** `handleUserInDatabase`
(`src/lib/auth.ts`) rewrites `first_name`, `last_name`, `promo` and `formation`
on **every** login, **nulls included**. Until 2026-08-24 it skipped the absent
claims, so a _change_ in Authentik propagated but a _removal_ never did: a promo
the school had taken off an account kept opening that promo's albums, with
nothing in the product able to close it. Writing the null is sound only because
of where that runs - `completeOIDCFlow` reaches it after the token exchange
**and** the userinfo fetch have both succeeded, so a missing claim is the IdP's
answer, never an unreachable IdP; a transport failure returns earlier and
touches nothing. Every erasure is logged at WARN with the value it replaced.

`role`, `photos_id`, `photos_asset_id` and `locale` are deliberately outside
that set - they are MiGallery's own, and are left out of the update payload so
the generated `SET` never names them. `tests/sso-mirror.test.ts` pins all four
behaviours against a throwaway SQLite file.

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

## Signed in from Canari (the sign-in handoff)

**Canari, already signed in, opens MiGallery signed in**, instead of MiGallery asking for a MiConnect
login the browser has long forgotten. Canari mints a 60-second ES256 token naming the user (`sub`),
this site (`aud: migallery`) and a page (`dest`), and opens `https://gallery.mitv.fr/auth/handoff#<token>`.
The design, the threats and the contract are Canari's
([design note](https://github.com/emse-students/canari/blob/main/docs/wiki/backlog.d/sign-in-handoff-to-the-ecosystem-sites-and-migallery-notifications.md),
section 8). Canari turns it on for MiGallery with a flag, only after this is live.

**The landing page** (`src/routes/auth/handoff/+page.svelte`) reads the token from the FRAGMENT,
which no browser sends to a server, removes it from the address bar at once, and posts it to the
redemption. It is served `Cache-Control: no-store`, `Referrer-Policy: no-referrer` and
`Content-Security-Policy: frame-ancestors 'none'`, so no other page can frame the interstitial
(`hooks.server.ts`). **The interstitial is ALWAYS shown** before a session opens - "Tu vas être
connecté en tant que B", with B's photo, or "Tu es connecté en tant que A. Continuer en tant que B ?" -
except when this browser is already signed in as B, when nothing changes hands. Annuler writes
nothing. The photo is the SIGNED avatar URL (`avatar-signature.ts`), since the browser usually has
no session yet: only the holder of a token naming B is shown it, and it shows B's own photo only.

**The redemption**, `POST /api/auth/handoff` (`src/lib/server/handoff/redeem.ts`), in this order,
every refusal logged `[HANDOFF] refused class=<outcome> jti=<jti or none>` and **never the token**:

1. `Origin` exactly this site's own, else `403 bad_origin` (the `/api/auth/` prefix skips the
   global CSRF hook, so the route checks it itself); JSON; a token of at most 4096 characters.
2. Steps 1-3 of the contract, the VENDORED verifier `src/lib/server/handoff/handoff-verify.ts`
   (byte-identical to Canari's `libs/handoff/handoff-verify.ts`, compared by Canari's
   `tools/ecosystem-shape/shape.mjs`): ES256 only, `typ`, the ONE issuer `CANARI_HANDOFF_ISSUER`,
   audience `migallery`, 30 s of leeway, a lifetime of at most 60 s, `dest` through
   `safeRedirectTarget` (or `/`). The keys come from `CANARI_HANDOFF_JWKS` through jose's
   `createRemoteJWKSet` with a 60 s cache. **Keys that cannot be fetched** (Canari unreachable, a
   timeout, a non-200) are `503 keys_unavailable`, logged at ERROR - an outage, never the token's
   fault; the verifier decides it inside the key resolver, so nothing a token carries can be
   classified as one.
3. No `confirm: true` -> the interstitial's data, **nothing written**: the click posts the same
   token again. A `sub` with no `users` row -> `unknown_user`, and the page goes through the ordinary
   MiConnect login with `redirectTo=dest` (an honest first visit).
4. **Single use from durable state**: `INSERT OR IGNORE INTO handoff_redemptions`, `jti` the
   primary key, in ONE transaction with step 6 (`inTransaction`), so the ledger row, the old
   session's deletion and the new session land together or not at all. No row inserted -> `409 replayed`, at warn. The rows whose `exp` is past the leeway
   are deleted first, by proof: step 2 refuses their tokens as `expired` before they reach here.
5. **Admission (F1)**: the EXISTING row, nothing written on it - the claims are not refreshed by a
   handoff; the next MiConnect sign-in does that.
6. **The ordinary session, MARKED**: one `sessions` row, 7 days, the `migallery_session` cookie,
   and `via_handoff = 1`. A session of another user in this browser is deleted first; the same
   user's is kept as it is.

**The step-up - what makes a forged handoff harmless** (`src/lib/server/step-up.ts`, `src/lib/step-up.ts`).
Anyone with a Canari account can mint a token for THEMSELVES and carry it to a victim's browser,
which would then browse as the attacker - and could, say, enrol their own face into the attacker's
account. So a marked session may BROWSE and may CHANGE NOTHING: `hooks.server.ts` refuses every
`POST`, `PUT`, `PATCH` and `DELETE` from it with `403 { code: "STEP_UP_REQUIRED" }` and the header
`x-step-up-required: 1`, before any handler runs - DEFAULT DENY, so a new route is guarded without
anyone remembering it. The exemptions are an explicit list, each with its reason (logout, the
redemption itself, `change-user`, the display language, the download token). The browser
(`hooks.client.ts`) sends a refused page through the ordinary MiConnect sign-in with the page as
its destination; the callback deletes the marked session and opens an unmarked one, so after one
MiConnect sign-in the user acts normally. `tests/step-up.test.ts` loads every route module in
`src/routes` and reads the handlers it really exports and fails on a route the guard lets through or an exemption that names no route.

**Configuration**: `CANARI_HANDOFF_ISSUER` and `CANARI_HANDOFF_JWKS`, defaults in
`docker-compose.prod.yml` (production Canari, `https://canari.emse.fr`). Unset, the redemption
answers `404 not_offered` and the page goes to the ordinary login.

**Tests**: `tests/handoff.test.ts` - every vector of Canari's `handoff-token.cases.json` (copied to
`tests/fixtures/`, regenerated only in Canari), the replay, a wrong `Origin`, the interstitial with
no session and with another user's, `unknown_user`, the marked session, the token in no log line;
`tests/step-up.test.ts` - the guard and the route enumeration.

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
