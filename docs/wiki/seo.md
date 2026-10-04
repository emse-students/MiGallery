# Search engines and link previews

**Source**: `src/lib/seo.ts`, `src/lib/server/site-origin.ts`,
`src/lib/components/Seo.svelte`, `src/routes/+layout.server.ts`,
`src/routes/robots.txt/+server.ts`, `src/routes/sitemap.xml/+server.ts`,
`src/routes/cgu/+page.ts`, `src/routes/albums/[id]/+page.server.ts`,
`tests/seo.test.ts`

## The decision everything here follows from

**MiGallery is indexed since 2026-10-04**, decided by the user against the
default of refusing every crawler for a private gallery of named students. Until
then `static/robots.txt` said `Disallow: /` and every page carried `noindex`.

What may rank is the **public surface only**: the pages an anonymous visitor can
open. Read from the guards, that is exactly two pages:

| Path   | Why it is public                                          |
| ------ | --------------------------------------------------------- |
| `/`    | the landing page; signed out it shows the sign-in card    |
| `/cgu` | the terms and privacy policy; no `+page.server.ts` at all |

Everything else is NOT, for one of two reasons:

- **It redirects an anonymous visitor to the sign-in** (`303`): `/albums`,
  `/albums/[id]` for `authenticated` and `private` albums, `/mes-photos`,
  `/parametres`, `/photos-cv`, `/admin/*` (`requireAdminPage`).
- **It is an UNLISTED album.** `/albums/[id]` renders without a session when the
  album is `unlisted` - but "unlisted" means "only whoever was handed the link",
  and a sitemap is a link handed to everybody. So no album, of any visibility, is
  ever listed or indexable.

## One list, three consumers

`INDEXABLE_PATHS` in `src/lib/seo.ts` is the only statement of that surface, and
three things read it, so they cannot disagree:

```
INDEXABLE_PATHS  ->  <meta name="robots">   index, follow  |  noindex, nofollow
                 ->  /robots.txt             Allow: <path>$ ... Disallow: /
                 ->  /sitemap.xml            one <loc> per path
```

**`robots.txt` is an allowlist.** It allows each public page (anchored with `$`,
so `Allow: /$` is the home page and nothing under it), the app's `/_app/` JS and
CSS (a search engine renders a page before judging it), the files in `static/`,
and the sitemap - then `Disallow: /`. Crawlers resolve Allow against Disallow by
the LONGEST match. A denylist (`Disallow: /api`, `/admin`, ...) would publish the
next private route the day somebody adds one. `tests/seo.test.ts` holds
`CRAWLABLE_STATIC_FILES` to the `static/` directory, so a new static file cannot
silently stay disallowed.

The trade-off, taken knowingly: a disallowed URL is never fetched, so a crawler
never SEES the `noindex` on it, and an unlisted album URL posted publicly
somewhere could still appear as a bare, contentless result. Allowing the crawl so
the `noindex` is read would mean letting a crawler fetch the album page itself.

**`sitemap.xml` answers `200`**, never a redirect (a crawler drops a sitemap that
moves), as `application/xml`.

Both are ROUTES, not files in `static/`: `robots.txt` names the sitemap by
absolute URL, and that URL follows the configured origin. A file in `static/`
would also shadow the route - adapter-node serves static files first.

**Adding a public page** means adding it to `INDEXABLE_PATHS`, nothing else - and
the test refuses one that has a `+page.server.ts`, because every sign-in guard
here lives in one and an indexed URL answering `303` is a broken sitemap entry.

## The origin comes from configuration

Every absolute URL - canonical, `og:url`, `og:image`, the sitemap's `<loc>`,
`robots.txt`'s `Sitemap:` line - is built from `siteOrigin()`
(`src/lib/server/site-origin.ts`), which reads **`ORIGIN`**: the variable
adapter-node already reads for the same fact (`docker-compose.prod.yml`,
[deployment](deployment.md#configuration)). The final hostname of the gallery is
not decided (it is `gallery.mitv.fr` today), and a canonical naming the wrong
host hands its ranking to it - so **moving the gallery is setting `ORIGIN`, not a
code change.** The root layout returns it as `siteOrigin` in the page data for
`Seo.svelte`.

When `ORIGIN` is unset or not an http(s) URL (`vite dev` without a `.env`), the
request origin is used and a warning is logged once: in production that would
mean every canonical names whatever host the request reached.

## The head, assembled in one place

The root layout renders `<Seo meta={...} />`:

```
page.data.seo  ??  siteSeo()      ->   <Seo>   ->   description, robots,
                                                    canonical, og:*, twitter:*
```

A page contributes its card by returning `seo` from its `load`: the album page
(the URL people share) and `/cgu` (its own description). **A page never writes
`<meta name="description">` itself** - `/cgu` used to, on top of the layout's, and
two descriptions is a search engine picking one. The home page uses the gallery's
own card (`app_meta_description`, localized through Paraglide).

`<title>` is the exception and stays with the pages: every route sets one. Svelte
deduplicates `<title>` inside `<svelte:head>` and the page's wins.

There is no `hreflang`: the locale is chosen by cookie and `Accept-Language`, not
by URL, so both languages are the same URL.

## The second audience: unfurlers

> **An unfurler is not a crawler.** Discord, Slack, WhatsApp and Canari's own
> link preview fetch the exact URL somebody pasted, and never read `robots.txt`.

Sharing an album link is a supported action - it is what `unlisted` visibility
exists for - so the card that link produces is part of the product, on pages
that are `noindex` and disallowed all the same.

**A private album gets no image.** An `og:image` is fetched by whoever the link
reaches, with no session and no permission check, so publishing one would hand
out the cover of an album the recipient cannot open. This is the one line in the
file where a careless simplification would leak something.

`og:image:width`, `og:image:height` and `og:image:type` are declared only for an
image whose size is KNOWN: the album cover (`/api/albums/[id]/og-cover` renders a
fixed 1200x630 WebP) and the default card (`static/og-image.jpg`, whose size the
test reads from the file). `twitter:card` is always present: without it X and the
clients that copy its vocabulary render a bare link.

## Verifying a change

`tests/seo.test.ts` checks the builders AND what the suite's own server serves
(`bun run test` starts it with `ORIGIN` = its URL): `robots.txt` and
`sitemap.xml` answer `200` with the right type, each public page is
`index, follow` with one description and a canonical, and `/albums` answers an
anonymous visitor `303`.

Against a running instance:

```sh
curl -si https://gallery.mitv.fr/robots.txt
curl -si https://gallery.mitv.fr/sitemap.xml
curl -s https://gallery.mitv.fr/ | grep -oE '<(meta name="robots"|link rel="canonical")[^>]*>'
```

`curl` is the right tool and a browser is not: a browser runs the JavaScript, so
it cannot tell you what the SERVER wrote - which is all a crawler or an unfurler
ever sees.

## Owed by hand

- Search Console: verify the gallery's host (a DNS TXT record on the domain, or
  the HTML-file method) and submit `/sitemap.xml`. Owed again on the final
  hostname, with a change of address from the old one.

## Related

- [albums-and-permissions.md](albums-and-permissions.md) - what `unlisted` means
  and who may open an album
- [authentication.md](authentication.md) - the guards that decide what is public
- [deployment.md](deployment.md#configuration) - where `ORIGIN` is set
