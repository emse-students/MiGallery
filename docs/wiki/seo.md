# Link previews, and the ONE page a search engine may index

**Source**: `src/lib/seo.ts`, `src/lib/components/Seo.svelte`,
`src/routes/+layout.svelte`, `src/routes/albums/[id]/+page.server.ts`,
`src/hooks.server.ts`, `static/robots.txt`

## The rule, decided by the user on 2026-10-06

MiGallery is a private photo gallery of named students. It used to refuse every crawler
(`Disallow: /`, "deliberate and permanent"). **That is now an allowlist of ONE: the home page**,
which presents the gallery and offers a sign-in button, and shows no photo, no album and no name.
Everything else stays out of every index.

`isIndexable(pathname)` in `src/lib/seo.ts` is that allowlist (`pathname === '/'`), and three things
read it, so they cannot disagree:

| Where                                | What it does for `/`                                                    | What it does for everything else  |
| ------------------------------------ | ----------------------------------------------------------------------- | --------------------------------- |
| `static/robots.txt`                  | `Allow: /$` (the root alone; the longer rule wins in Google's matching) | `Disallow: /`                     |
| `Seo.svelte`                         | `<meta name="robots" content="index, follow">` plus a JSON-LD `WebSite` | `noindex, nofollow`               |
| `robotsHandler` in `hooks.server.ts` | nothing                                                                 | `X-Robots-Tag: noindex, nofollow` |

The header is the second voice, for an engine that never fetched `robots.txt` or already knows a URL.
A thrown `redirect()` does not come back through `resolve` - it travels up as an exception - so the
handler converts it into the response it would have become before stamping it.

The JSON-LD (`siteNode`) states what the site is and who runs it, from facts the app already carries,
and **nothing about a photo, an album or a person** (`tests/seo.test.ts` asserts it). There is still
no sitemap.

## The other audience, unchanged

> **An unfurler is not a crawler.** Discord, Slack, WhatsApp and Canari's own
> link preview fetch the exact URL somebody pasted, and never read `robots.txt`.

Sharing an album link is a supported action - it is what `unlisted` visibility exists for - so the card
that link produces is part of the product. The album page has carried Open Graph tags for that reason
since before this page existed. They are not in tension with `noindex`: it addresses crawlers, the tags
address unfurlers, which ignore both.

## One head, assembled in one place

The root layout renders `<Seo meta={...} />` and nothing else touches
`<svelte:head>` for card tags:

```
page.data.seo  ??  siteSeo()      ->   <Seo>   ->   description, robots,
                                                    canonical, og:*, twitter:*
```

A page contributes its card by returning `seo` from its `load`. **Only the album
page does**, because it is the only URL anybody shares. Everything else falls
back to the gallery's own card.

`<title>` is the exception and stays with the pages: every route sets one. The
layout carried `<title>MiGallery</title>` as well, and it never reached a single
page - Svelte deduplicates `<title>` inside `<svelte:head>` and the page's wins,
so the layout read as the source of a title it never supplied. Measured on prod
before the change: `/` served exactly one, `MiGallery - Accueil`. It is gone.

### What the album contributes, and what it withholds

`src/routes/albums/[id]/+page.server.ts` builds the whole card - name, a
description of the form `15 mai 2024 - Paris`, and the cover.

**A private album gets no image.** An `og:image` is fetched by whoever the link
reaches, with no session and no permission check, so publishing one would hand
out the cover of an album the recipient cannot open. That rule predates this
page; it is stated here because it is the one line in the file where a careless
simplification would leak something.

`og:image:width`, `og:image:height` and `og:image:type` are declared **only for
the album cover**. `/api/albums/[id]/og-cover` renders a fixed 1200x630 WebP, so
they describe that image; the site logo is a different shape, and declaring a
size an image does not have is worse than declaring none - an unfurler that has
them lays the card out before the image arrives.

### Absolute URLs come from the request

`og:image`, `og:url` and `link rel=canonical` are resolved by a machine with no
page context, so a relative path is silently useless to every one of them. They
are built from `page.url.origin` - never a constant - so the same code is right
on production and on localhost.

### What was added

The album card was Open Graph only. Missing, and now present: `twitter:card`
(without it X and the clients that copy its vocabulary render a bare link rather
than falling back to the Open Graph image), `twitter:title/description/image`,
`og:url`, `og:locale`, `og:image:alt`, and a canonical link. The gallery root had
no card at all, so a link to `https://gallery.mitv.fr` unfurled as a bare URL.

## Verifying a change

Against a local production build:

```sh
curl -s http://localhost:5173/albums/<unlisted-id> | grep -o '<meta name="twitter:card"[^>]*>'
curl -s http://localhost:5173/albums/<unlisted-id> | grep -o '<meta property="og:image"[^>]*>'
curl -s http://localhost:5173/robots.txt
```

Use an **unlisted** album: any other visibility redirects an anonymous request to
the login bounce before the head is ever rendered, so what you would be measuring
is the sign-in page.

`curl` is the right tool and a browser is not: a browser runs the JavaScript, so
it cannot tell you what the SERVER wrote - which is the only thing an unfurler
ever sees.

## Related

- [albums-and-permissions.md](albums-and-permissions.md) - what `unlisted` means
  and who may open an album
- [architecture.md](architecture.md) - the SSR shape this depends on
