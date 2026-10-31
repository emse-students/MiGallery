# The Immich proxy

Immich is the photo backend; MiGallery never holds media itself. Almost all media
traffic goes through one universal handler,
`src/routes/api/immich/[...path]/+server.ts`, which forwards requests to the
Immich REST API with the server-side `IMMICH_API_KEY` after checking access.

## Responsibilities

- **Authorize** the request with `requireScope` (read for GETs, write for
  mutations) before anything is forwarded. The browser never sees the Immich API
  key; MiGallery attaches it server-side.
- **Forward** the path and query to `IMMICH_BASE_URL/api/...`, copying safe
  headers. Header values are passed through `sanitizeHeaderValue`, which strips
  non-Latin-1 characters (special apostrophes etc. otherwise crash `fetch`).
- **Stream binary responses** (images, videos, thumbnails, archives) straight
  back to the client without buffering. Media caching is delegated to HTTP: the
  proxy forwards `etag`/`cache-control`/`last-modified`, so the browser and the
  reverse proxy hold thumbnails, not the Node process. The one exception is an
  asset's detail stripped of its people (below): it leaves without Immich's
  validators and the proxy forwards no conditional header for it, since they
  describe a body the member never received.
- **Memoize public-access metadata** with a tiny in-process TTL map, scoped only
  to `checkPublicAssetAccess`. Browsing a public shared album would otherwise
  re-fetch the same asset/album metadata from Immich once per image.

## Only listed routes are forwarded

The proxy speaks to Immich with the server's key, so it forwards an ALLOWLIST of methods and
paths - the ones MiGallery's own pages use - and answers 404 to everything else, whoever asks,
admin keys included (`src/lib/server/immich-proxy-allowlist.ts`). The path is judged as Immich
will route it (`.` segments resolved, case and repeated slashes folded, a decoded `?` or `#`
refused), and ids must be Immich UUIDs. The admin trash routes (`timeline/*`,
`trash/restore/assets`) also require the admin scope. The consent rule on the person routes
(`assertProxiedFaceAccess`) still applies on top.

**One path for every decision.** The decoded path is canonicalised ONCE
(`canonicalProxiedPath`): `.` and `%2e` segments resolved as the URL parser resolves them, case
folded, slashes collapsed; a path that keeps a `%` after that (a second level of encoding), carries
its own `?` or `#`, or resolves outside `/api/` is refused (400). That one string is what the
public-asset exception, the list, the face rule, the body rule, the audit log and the URL sent to
Immich all read.

**The public exception** serves an anonymous read of exactly
`assets/<id>/(thumbnail|original|video/playback)` of an asset in an unlisted album, nothing longer.

**Deleting assets** (`DELETE assets`) is allowed to an admin or mitviste session and to an admin
API key; a member may delete only assets they uploaded themselves as new files (the proxy's own
`import` audit row, `src/lib/server/asset-uploads.ts`; a duplicate upload does not count).

**Who uploaded an asset is read from the audit log, so the log's rules are its rules:**

- **The latest row wins.** `uploadOf` reads the most recent `import` row for that asset and that
  member (`ORDER BY id DESC`). A member who uploads a file and later uploads the same file again
  (Immich answers `duplicate`) is judged on that later row, which does not count: the newest answer
  is the one believed, not the first.
- **Ninety days.** `purgeOldLogs` deletes audit rows older than `LOG_RETENTION_DAYS` (90,
  `src/lib/server/logs.ts`). After that an upload is no longer the member's for this purpose: they
  cannot delete it through the proxy, and an admin or mitviste has to. The selfie flow is not
  affected (it only reads uploads younger than half an hour).
- **Impersonation.** An audit row names the account that ACTED, so an upload made while an admin
  impersonates a member is recorded under the admin. Acting as the member, that upload is not
  theirs: deleting it, or reading it as a selfie, answers 403. Linking a face is refused outright
  while impersonating (`/api/users/me/face`).
- **A lost row is an error.** The `import` row is authorisation state, so a failed write of it is
  logged at error, not swallowed as a warning (`AUTHORISING_EVENTS` in `logs.ts`), and so is an
  upload answer the proxy could not read to record.

**Search** (`POST search/metadata`) takes only the profile photo picker's body: `personIds`
(required, then held to the consent rule), `type`, `page`, `size`.

**An asset's detail** reaches a member without its `people` and `unassignedFaces`; an admin
session and an API key see them. The settings page's selfie flow reads what Immich found on the
member's own new upload through `GET /api/users/me/face/selfie/[assetId]` instead: a count, and a
person id only when exactly one person is found, and only for an upload within the selfie window
(`isFreshSelfie`, half an hour from when Immich received the file, `face-access.ts`); anything older
answers 403. `selfieProves`, which the link `PATCH` runs, applies the same window.

**An album's detail** (`GET albums/<id>`) carries no people to strip: measured 2026-10-31 on
the Immich in production (v3.3.3), it no longer lists the album's assets at all, with or without
`withoutAssets=false`. Re-measure on an Immich upgrade; if assets come back with `people`, strip
them as the asset detail is.

A page that needs another Immich route adds it to the list, with the page that uses it and a case
in `tests/immich-proxy-allowlist.test.ts`; anything MiGallery has to join with its own state
belongs in a dedicated route instead.

## Public (unlisted) assets

Albums can be `unlisted` (shared by link, see
[albums-and-permissions.md](albums-and-permissions.md)). For those, individual
assets must be reachable without a session. `checkPublicAssetAccess(assetId, …)`
asks Immich which albums an asset belongs to and allows the request when the
asset is in an unlisted album. This is how a public album link renders its photos
to a signed-out visitor while everything else stays gated.

## Chunked uploads

Uploads are streamed to disk, never buffered in memory - no `Buffer.alloc` on the
upload path, pinned by `tests/memory-invariants.test.ts`:

- **Small files (< 10 MB)**: a simple `POST /api/immich/assets` with `FormData`.
- **Large files (>= 10 MB)**: 5 MB chunks with resume support and a per-chunk
  SHA-256. The server streams each chunk to disk under `data/chunk-uploads/`
  (`fs.createWriteStream`, zero RAM). Concurrency is guarded by a per-file lock
  (`fs.openSync(lockPath, 'wx')`). On completion the assembled file is streamed to
  Immich via `fs.createReadStream` inside a `form-data` body.

Do not reintroduce `Buffer.alloc` or chunk accumulation for anything larger than
a few MB - it defeats the streaming design and blows up memory on big videos.

### The lock: release-on-error, and a stale one takes over rather than wedging

Found live 2026-09-28: an error thrown while the lock was held (an aborted
request body, a write failure) used to skip the release and fall into the
outer catch, which cleaned up the `.part` file but never `lockPath`. `fileId`
is deterministic (name+size+mtime, on purpose, for resume), so the orphan
made every future retry of that exact file - including after reconnecting -
fail forever with `409 File currently locked, retry`. The outer catch now
releases the lock too.

That closes the leak going forward, but three months of orphaned `.lock`
files (from 2026-07-08, never cleaned) were found sitting in
`data/chunk-uploads/` on the production host on the same day - proof this had been
happening silently long before it was noticed. There is no cron for this
directory (`scheduled.yml` only runs the nightly security pass), and adding
one would need prod SSH from CI for a problem the request handler already
sees on every call. Instead, the handler self-heals: acquiring a lock that is
already held checks its age first - a real chunk write completes in well
under a minute even on a slow link (see [bandwidth](bandwidth.md)), so a lock
older than `STALE_LOCK_MS` (10 min) cannot belong to anything legitimate, and
the next request takes it over instead of answering 409 forever. Chunk 0 of
every new upload also opportunistically sweeps `.part`/`.lock`/`.complete`
files untouched for `STALE_UPLOAD_MS` (48 h) - genuinely abandoned uploads,
not a schedule to keep alive.

## Why a universal handler

Routing everything through one `[...path]` handler keeps a single place for the
scope check, the API-key injection, the header sanitation, the public-asset
exception, and the binary passthrough. Endpoints outside this handler (under
`/api/albums`, `/api/people`, `/api/users`, …) exist when MiGallery needs to join
Immich data with its own SQLite state (permissions, favorites, roles) rather than
a pure passthrough.
