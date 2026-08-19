# The deadline on an outbound call

**Source**: `src/lib/server/outbound.ts`, and every `+server.ts` that talks to
Immich or to Authentik.

## Why this page exists

MiGallery owns almost nothing it renders. A gallery page is a proxy: the albums,
the assets, the thumbnails and the archive all come from Immich over HTTP, and
the login comes from Authentik the same way. So a request in flight here is
nearly always a request waiting on somebody else.

`fetch` has no timeout of its own. Until 2026-08-19 not one of the thirty-odd
server-to-server calls in this repo carried a signal, which means an Immich that
accepted the connection and then said nothing held the request behind it - and
nothing recovers from that state. There is no error to catch, no status to
branch on and no fallback to reach, only a page that never finishes and a reader
who reloads.

Node 24 does bound it eventually: undici's `headersTimeout` is 300 s. Five
minutes is long after the browser, the reverse proxy and the reader have all
given up, so the effect is the same as unbounded, only harder to see in a log.

## The number

```ts
export const OUTBOUND_BUDGET_MS = 4000;
```

Four seconds, which is the number the rest of the ecosystem already states -
Sky's `OUTBOUND_BUDGET_MS`, Portail-etu's, Canari's link-preview guard. **One
number rather than thirty**, because a budget that differs per call site is a
budget nobody can state, and because a slow Immich should degrade at the same
moment everywhere it is read.

## Three kinds of call, and only two of them can be bounded here

The budget is on the **answer**, never on the transfer. That distinction is the
whole design, and getting it wrong would fail on a healthy upstream rather than
a broken one.

| Kind           | What it looks like                                                                                  | What it uses                                                       |
| -------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| A small answer | album metadata, an asset detail, a people list, the OIDC token and userinfo calls                   | `signal: AbortSignal.timeout(OUTBOUND_BUDGET_MS)` at the call site |
| A download     | `asset-original`, the thumbnail proxies, `/api/download/[token]`, every GET through `/api/immich/*` | `fetchWithAnswerDeadline()`                                        |
| An upload      | `POST /api/external/media`, any body forwarded through `/api/immich/*`                              | nothing here - see below                                           |

**A small answer** is bounded end to end, headers and body together. That is
what `AbortSignal.timeout()` does, and for two kilobytes of JSON it is the whole
story.

**A download** cannot be. Its body IS the product - an album archive of several
gigabytes to somebody on a train - so a 4 s abort would not fix a stall, it
would break every large download. `fetchWithAnswerDeadline()` starts a timer,
hands `fetch` an `AbortController`, and **clears the timer the moment the
response headers arrive**. After that the body streams on the connection's own
terms. Undici still bounds a body that goes silent mid-stream (`bodyTimeout`,
300 s of INACTIVITY rather than of duration), so a dead transfer is not
unbounded either; it is simply a different failure with a different right
answer.

**An upload** cannot be bounded by anything this file can offer, and that is
stated rather than papered over. The body is the file the caller is sending, so
a clock started before `fetch` resolves would measure how big that file is, not
whether Immich is answering - a 200 MB video would abort every time. `fetch`
exposes no hook for "after the request has been sent", so what bounds an upload
is undici's `headersTimeout`. The two upload call sites say so in a comment, and
the catch-all proxy picks its treatment from whether it has a body to forward:

```ts
const res = bodyToForward
	? await fetch(resolvedRemoteUrl, init)
	: await fetchWithAnswerDeadline(resolvedRemoteUrl, init);
```

## What is deliberately NOT bounded

- **Internal self-calls.** A few routes reach their own sibling endpoints
  (`/api/immich/assets/...`) through `event.fetch`, which dispatches to the
  handler in-process rather than over the network. The deadline belongs where
  the network is, and that is the inner handler, which has one. A signal here
  would be a bound that only looks like a bound.
- **Browser-side `fetch`.** Everything in `src/lib/photos.svelte.ts`,
  `album-operations.ts`, `client-cache.ts` and friends runs in the reader's tab,
  against this server. The reader and the browser bound those.

## How a timeout surfaces

**As a THROW, never as a status.** `AbortSignal.timeout()` rejects with a
`TimeoutError` and the helper's controller rejects with an `AbortError`, so the
`catch` around the call is what has to decide the upstream was unreachable. A
route that only inspects `res.ok` will never see one.

That is also why the budget does not change what any route REPORTS: an upstream
that is not answering was already an error path, it simply took five minutes to
get there.

## Verifying a change

`tests/outbound.test.ts` pins the property that matters - the signal is **not**
aborted once the headers are in and the budget has passed - by stubbing `fetch`
and capturing the signal it was handed. That is the assertion protecting large
downloads; the rest of the file checks that a silent upstream is given up on and
that a caller's own signal still works.

## Related

- [immich-proxy.md](immich-proxy.md) - the catch-all proxy this budget runs
  through
- [downloads.md](downloads.md) - the archive path, the largest body here
- [authentication.md](authentication.md) - the two Authentik calls, the only
  outbound calls that are not Immich
