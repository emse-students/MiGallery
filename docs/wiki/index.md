# MiGallery technical wiki

MiGallery is MiTV's photo gallery for EMSE. It wraps **Immich** (a self-hosted
photo backend) and adds role-based access control, album management with
fine-grained permissions, SSO via Authentik (MiConnect), a face-recognition
directory (trombinoscope / photos CV), and a Svelte UI. The SvelteKit server acts
mainly as an **authenticated proxy** in front of the Immich REST API: Immich
stores and serves the media, MiGallery decides who may see what.

This wiki is the canonical, English source of truth for how MiGallery works. It
is written against the code; when a page and the code disagree, the code wins and
the page is a bug.

## Stack at a glance

- **Framework**: SvelteKit 2 + Svelte 5 runes (SSR, `adapter-node`), TypeScript
- **Styling**: Tailwind CSS 4
- **Local database**: SQLite via `better-sqlite3` (synchronous by design)
- **Auth**: Authentik OIDC (MiConnect) + signed session cookies
- **Photo backend**: Immich, proxied through `/api/immich/*`
- **Runtime**: Bun preferred for tooling; Node in the production container

## What MiGallery owns vs delegates

- **Immich owns**: the actual photos/videos, thumbnails, face detection, the
  underlying albums and assets.
- **MiGallery owns** (local SQLite): users and their roles/promo/formation, album
  visibility and the four permission dimensions, per-user favorites, photo-access
  consent for the CV directory, audit logs, and API keys.

## Map of the wiki

| Page                                                   | What it covers                                                               |
| ------------------------------------------------------ | ---------------------------------------------------------------------------- |
| [architecture.md](architecture.md)                     | Request lifecycle, hooks, CORS/CSRF, repo layout                             |
| [authentication.md](authentication.md)                 | OIDC login, session cookies, roles, scopes, API keys, impersonation          |
| [immich-proxy.md](immich-proxy.md)                     | The universal `/api/immich/*` proxy, chunked uploads, public assets, caching |
| [albums-and-permissions.md](albums-and-permissions.md) | Album visibility and the four permission dimensions                          |
| [photos-cv.md](photos-cv.md)                           | Trombinoscope, face-based "my photos", RGPD photo-access consent             |
| [downloads.md](downloads.md)                           | Token-based archive download (no StreamSaver)                                |
| [data-model.md](data-model.md)                         | The local SQLite schema                                                      |
| [api-reference.md](api-reference.md)                   | Endpoint groups, auth and shape                                              |
| [deployment.md](deployment.md)                         | Docker, CD, secrets, backups                                                 |

## Conventions used in MiGallery code

- Code comments and developer-facing strings (logs, thrown errors) are English.
  User-visible text goes through i18n, never inline (see the i18n rollout).
- Text is ASCII (straight `'` and `"`, hyphen `-`); the ellipsis `…` is the one
  intentional exception.
- Svelte 5 runes only (`$state`, `$derived`, `$effect`), never the legacy `$:`.
- Icons: `lucide-svelte` only, and only names that exist in the installed version.
- No memory buffering for large media: uploads stream to disk, downloads use a
  native token flow. Never accumulate multi-MB buffers.
