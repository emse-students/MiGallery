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
  reverse proxy hold thumbnails, not the Node process.
- **Memoize public-access metadata** with a tiny in-process TTL map, scoped only
  to `checkPublicAssetAccess`. Browsing a public shared album would otherwise
  re-fetch the same asset/album metadata from Immich once per image.

## Only listed routes are forwarded

The proxy speaks to Immich with the server's key, so it forwards an ALLOWLIST of methods and
paths - the ones MiGallery's own pages use - and answers 404 to everything else, whoever asks,
admin keys included (`src/lib/server/immich-proxy-allowlist.ts`). The path is judged as Immich
will route it (`.` segments resolved, case and repeated slashes folded, a decoded `?` or `#`
refused), and ids must be Immich UUIDs. The admin trash routes (`timeline/*`,
`trash/restore/assets`) also require the admin scope. No person, face or search route is on
the list since lot A6, and the refusal below still applies on top of it.

**One path for every decision.** The decoded path is canonicalised ONCE
(`canonicalProxiedPath`): `.` and `%2e` segments resolved as the URL parser resolves them, case
folded, slashes collapsed; a path that keeps a `%` after that (a second level of encoding), carries
its own `?` or `#`, or resolves outside `/api/` is refused (400). That one string is what the
public-asset exception, the list, the face rule, the audit log and the URL sent to
Immich all read.

**The public exception** serves an anonymous read of exactly
`assets/<id>/(thumbnail|original|video/playback)` of an asset in an unlisted album, nothing longer.

**Deleting assets** (`DELETE assets`) is allowed to an admin or mitviste session and to an admin
API key; a member may delete only assets they uploaded themselves as new files (the proxy's own
`import` audit row, `src/lib/server/asset-uploads.ts`; a duplicate upload does not count).

A page that needs another Immich route adds it to the list, with the page that uses it and a case
in `tests/immich-proxy-allowlist.test.ts`; anything MiGallery has to join with its own state
belongs in a dedicated route instead.

## No person, no face - for anyone (lot A6)

The proxy refuses (403), BEFORE anything is forwarded and whoever asks, admins and API keys
included, every call Immich would answer from its face recognition: any `people/...`,
`faces/...` or `search/person` path, and any query or JSON body key starting with `personId` or
`withPeople` (any spelling, any value, empty included, at any depth of the body: Immich v3 nests
its search conditions under `filter`). One function decides it,
`assertNoProxiedFaceCall` in `src/lib/server/face-access.ts`; it judges the path Immich will
route (`.` segments resolved, slashes collapsed, case folded) and refuses a path carrying its own
`?` or `#` (400). On the way back, a JSON answer of any other call loses its `people` and
`unassignedFaces` fields (`stripFaceFields`, an asset's detail is the case that carries them); a
JSON answer that names them and cannot be parsed is refused (502) rather than forwarded. A
member's photos come from MiGallery's own matches instead
([face-matching-option-c.md](face-matching-option-c.md#a6---the-read-side)). Pinned by
`tests/face-access.test.ts` (the rule) and `tests/immich-proxy-faces.test.ts` (the handler, an admin
session and an API key refused, Immich never asked).

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
