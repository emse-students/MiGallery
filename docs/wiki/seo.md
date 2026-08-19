# Link previews (and why there is no SEO)

**Source**: `src/lib/seo.ts`, `src/lib/components/Seo.svelte`,
`src/routes/+layout.svelte`, `src/routes/albums/[id]/+page.server.ts`,
`static/robots.txt`

## The constraint everything here follows from

MiGallery is a private photo gallery of named students, and `static/robots.txt`
refuses every crawler with `Disallow: /`. **That posture is not changing.** So
there is nothing on this page about search results: no JSON-LD, no sitemap, no
keywords. Structured data with no consumer is decoration that reads as effort.

What the head IS for is one audience:

> **An unfurler is not a crawler.** Discord, Slack, WhatsApp and Canari's own
> link preview fetch the exact URL somebody pasted, and never read `robots.txt`.

Sharing an album link is a supported action - it is what `unlisted` visibility
exists for - so the card that link produces is part of the product. The album
page has carried Open Graph tags for that reason since before this page existed.

The pages also carry `<meta name="robots" content="noindex, nofollow">`. It is
not in tension with the Open Graph tags below: it addresses crawlers, which are
already refused, while the tags address unfurlers, which ignore both.

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
