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
  back to the client without buffering.
- **Cache** selected Immich GETs in-process via `immichCache`
  (`src/lib/server/immich-cache.ts`) to avoid re-hitting Immich for hot metadata
  (e.g. asset lookups used in public-access checks).

## Public (unlisted) assets

Albums can be `unlisted` (shared by link, see
[albums-and-permissions.md](albums-and-permissions.md)). For those, individual
assets must be reachable without a session. `checkPublicAssetAccess(assetId, …)`
asks Immich which albums an asset belongs to and allows the request when the
asset is in an unlisted album. This is how a public album link renders its photos
to a signed-out visitor while everything else stays gated.

## Chunked uploads

Uploads are streamed to disk, never buffered in memory (see the size rule in
`CLAUDE.md`):

- **Small files (< 10 MB)**: a simple `POST /api/immich/assets` with `FormData`.
- **Large files (>= 10 MB)**: 5 MB chunks with resume support and a per-chunk
  SHA-256. The server streams each chunk to disk under `data/chunk-uploads/`
  (`fs.createWriteStream`, zero RAM). Concurrency is guarded by a per-file lock
  (`fs.openSync(lockPath, 'wx')`). On completion the assembled file is streamed to
  Immich via `fs.createReadStream` inside a `form-data` body.

Do not reintroduce `Buffer.alloc` or chunk accumulation for anything larger than
a few MB - it defeats the streaming design and blows up memory on big videos.

## Why a universal handler

Routing everything through one `[...path]` handler keeps a single place for the
scope check, the API-key injection, the header sanitation, the public-asset
exception, and the binary passthrough. Endpoints outside this handler (under
`/api/albums`, `/api/people`, `/api/users`, …) exist when MiGallery needs to join
Immich data with its own SQLite state (permissions, favorites, roles) rather than
a pure passthrough.
