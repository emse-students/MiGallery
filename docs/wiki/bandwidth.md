# Bandwidth: a lossy path, not a small pipe

Production leaves through EMSE onto RENATER (AS2200, ~10 ms to Cloudflare Paris)
behind a Stormshield gateway (`10.0.0.1`), and reaches the internet through a
`cloudflared` tunnel. The path is symmetric and has capacity to spare, but it
**drops ~4% of outbound packets at random** (measured 2026-09-25: 4.4% TCP
retransmissions, 3.7% QUIC loss over 12 days; zero drops and zero NIC errors on
the host, so the loss is beyond it - ICMP is filtered from the gateway on, so no
hop could be blamed).

A loss-based congestion controller reads that as congestion and collapses. With
`cubic` and the tunnel on QUIC, each flow held ~0.5 MB/s, the tunnel's 4
connections flattened at ~1 MB/s for the whole site, and a 39 KB album list took
14 s while the CPU sat idle.

## The host fix (2026-09-25)

| Setting                                                                          | Where                                                                                     |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `net.ipv4.tcp_congestion_control = bbr` (model-based, shrugs off random loss)    | `/etc/sysctl.d/90-bbr.conf`, module in `/etc/modules-load.d/bbr.conf`                     |
| Tunnel on TCP so BBR applies to it: `TUNNEL_TRANSPORT_PROTOCOL=http2` (not QUIC) | drop-in `/etc/systemd/system/cloudflared.service.d/protocol.conf` - the unit is untouched |

| Measured                          | cubic + QUIC   | BBR + http2  |
| --------------------------------- | -------------- | ------------ |
| Direct upload, 1 flow             | ~0.5 MB/s      | 17-28 MB/s   |
| Direct upload, 4 flows            | ~2 MB/s        | ~55 MB/s     |
| Through the tunnel, per request   | 0.45-0.85 MB/s | 2.5-4.3 MB/s |
| Through the tunnel, 8 in parallel | 1.2 MB/s       | 12 MB/s      |

Rollback: delete the drop-in, `systemctl daemon-reload && systemctl restart
cloudflared`; delete the two BBR files and `sysctl -w
net.ipv4.tcp_congestion_control=cubic`.

**Restarting `cloudflared` cuts `ssh mitv`**: SSH goes through the same tunnel.
The restart itself completes (systemd runs it), and the session comes back in
~30 s - but if the tunnel does not, the only way in is the machine's console.

## What goes over the wire

Bytes still cost, the loss is still there, and the fix lives on one host. Keep
the page light:

| Surface           | Loads                                                                                                                                         | Never loads                                                            |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Grid tiles        | `thumbnail` (600x400, ~25 KB WebP since D1), via plain `<img>`, the HTTP cache, and only for the rows on screen ([photo-grid](photo-grid.md)) | the `preview` (~450 KB), whatever the DPR - a 30x multiplier per tile  |
| Lightbox          | `preview` of the photo shown AND of its two neighbours, so a swipe slides in a loaded photo ([viewer](viewer.md))                             | the `original` (~8 MB for a DSLR photo) until the user zooms past 130% |
| Album/person grid | `assets-stream` / `photos-stream`: one slim NDJSON line, gzip                                                                                 | a per-asset `GET /assets/{id}`, owner, EXIF, path, people              |

`src/lib/server/asset-ndjson.ts` builds both streams. Immich v3 search results
already carry `width` and `height` at the top level, which is all the justified
layout needs; `tests/asset-ndjson.test.ts` pins the line shape. On the client,
`consumeNDJSONStream`'s `onChunk` is where reactive state is published - once
per network chunk, not once per line.

## Cloudflare

- `/api/albums/*/cover` is public and immutable by design, yet Cloudflare
  does not cache extension-less `/api/` paths by default. A Cache Rule
  ("eligible for cache", respect origin headers) on
  `starts_with(path, "/api/albums/") and ends_with(path, "/cover")` takes covers
  off the uplink entirely. NOTHING session-gated belongs in that rule: avatars
  and face crops answer `private` for that reason, since an edge copy of a
  gated image is served to anyone holding the URL. `/api/immich/*` is
  `private` too.

## Measuring

- The host has no `tcpdump` or `iperf3`. Upload to
  `https://speed.cloudflare.com/__up` with `curl --data-binary`, one flow then
  several: throughput that grows with the flow count means per-flow limiting
  (loss), not a full pipe. `nstat -az TcpRetransSegs TcpOutSegs` before and
  after gives the retransmission ratio.
- Through the tunnel: fetch a public static file with a random query string
  (`/MiGallery.png?x=<random>`, 716 KB) FROM the host - `cf-cache-status: MISS`
  forces an origin pull, and the host's fast downlink leaves the tunnel uplink as
  the only bottleneck.
- `cloudflared` exposes per-connection counters on `127.0.0.1:20241/metrics`.
- Who is browsing is visible in Cloudflare Analytics, not in the app logs
  (MiGallery does not log requests).
