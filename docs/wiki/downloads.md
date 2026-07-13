# Archive downloads

Downloading a selection of photos (or a whole album) as an archive uses a
short-lived server token. This keeps large downloads streaming through the
server with the browser saving natively, and avoids the fragility of
client-side stream shims (the old StreamSaver + service-worker relay was
removed).

## Flow

1. **`POST /api/download`** - the client sends the asset ids (and a filename). The
   server creates a one-time token with `createDownloadToken(assetIds, filename)`
   (`src/lib/server/download-tokens.ts`) and returns it. Tokens live in an
   in-memory `Map`, expire after 5 minutes, and a sweeper purges expired ones
   every minute.
2. **`GET /api/download/[token]`** - the browser navigates to this URL. The server
   consumes the token (`consumeDownloadToken`, one-time use), streams the archive
   from Immich, and the browser downloads it natively (Content-Disposition).

## Rules

- The token is single-use: `consumeDownloadToken` deletes it on read, so a link
  cannot be replayed.
- Tokens are process-local (in-memory `Map`); they do not survive a restart and
  are not shared across instances. That is fine for the 5-minute download window.
- Keep the download path server-streamed + native save. Do not reintroduce a
  client-side stream shim (StreamSaver) or a fetch-intercepting service worker.

See `src/lib/immich/download.ts` for the Immich-side streaming and
`src/lib/server/download-tokens.ts` for the token store.
