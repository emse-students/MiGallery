# Bandwidth: the uplink is the bottleneck

Production sits behind a `cloudflared` tunnel on a host whose **uplink is capped
around 1 MB/s** (~8 Mbit/s, measured 2026-09-25; the downlink does 30 MB/s).
Every byte MiGallery serves shares that one pipe. While anyone browses, the
host's TX flattens at ~1000 KB/s and every other visitor waits: an album list of
39 KB took 14 s to arrive, a 450 KB preview 27 s. CPU is idle meanwhile.

So page weight, not server time, is what users feel. The rules below exist for
that reason.

## What goes over the wire

| Surface           | Loads                                                           | Never loads                                                            |
| ----------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Grid tiles        | `thumbnail` (~15 KB WebP), via plain `<img>` and the HTTP cache | the `preview` (~450 KB), whatever the DPR - a 30x multiplier per tile  |
| Lightbox          | `preview`                                                       | the `original` (~8 MB for a DSLR photo) until the user zooms past 130% |
| Album/person grid | `assets-stream` / `photos-stream`: one slim NDJSON line, gzip   | a per-asset `GET /assets/{id}`, owner, EXIF, path, people              |

`src/lib/server/asset-ndjson.ts` builds both streams. Immich v3 search results
already carry `width` and `height` at the top level, which is all the justified
layout needs; `tests/asset-ndjson.test.ts` pins the line shape. On the client,
`consumeNDJSONStream`'s `onChunk` is where reactive state is published - once
per network chunk, not once per line.

## Not in code

- Public, immutable responses (`/api/albums/*/cover`, `/api/users/*/avatar?v=`)
  are `cf-cache-status: DYNAMIC`: Cloudflare does not cache extension-less
  `/api/` paths by default. A Cache Rule ("eligible for cache", respect origin
  headers) on those paths takes them off the uplink entirely. Everything under
  `/api/immich/*` is `private` and must stay uncached at the edge.
- Measuring: the host has no `tcpdump`. Sample
  `/sys/class/net/eno1/statistics/tx_bytes` every few seconds; a flat line near
  1000 KB/s is the cap. Who is browsing is visible in Cloudflare Analytics, not
  in the app logs (MiGallery does not log requests).
