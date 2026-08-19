# Search - typo, accent and word-order tolerance

Every search box in MiGallery goes through `src/lib/fuzzy.ts`. There is no second matcher and no
per-surface filter: a search box that wrote its own `.includes()` is how one of them ended up on
plain substring matching while the other three were tolerant.

## The requirement

The standing rule across the ecosystem is that **a search box tolerates typos and word inversion,
and RANKS by closeness** - it does not merely filter. The three projects meet it differently
because their data lives differently:

| Project   | Where                             | How                                                                        |
| --------- | --------------------------------- | -------------------------------------------------------------------------- |
| Canari    | Postgres (`applyFuzzyNameSearch`) | pg_trgm `word_similarity` + `unaccent`, ordered by a `search_score` column |
| Sky       | in memory (`personMatchScore`)    | normalized substring + per-token edit distance, ranked                     |
| MiGallery | in memory (`fuzzySearch`)         | the same, generalised over any joined haystack                             |

## The API

```ts
fuzzySearch(items, query, (item) => 'every field worth matching, joined'); // filtered AND ranked
fuzzyScore(query, haystack); // number | null; LOWER is better, null = no match
fuzzyMatch(query, haystack); // boolean face, for a caller that genuinely only filters
editDistance(a, b); // Damerau-Levenshtein (transposition costs one)
normalizeText(s); // lowercase, accents stripped
```

**Call `fuzzySearch`.** It filters and orders in one step, so ranking cannot be the thing a surface
forgets, and it returns the list unchanged for an empty query - the caller's own alphabetical or
chronological order survives.

## How a score is decided

Three tiers, in order of how literally the reader meant it:

1. **The whole query appears verbatim** - the score IS the position, so "mar" ranks `Marie` above
   `Omar`.
2. **Every query token matches some haystack token**, by substring or by a small edit distance.
   Each token adds `10 + distance`, so a token match always ranks below a verbatim hit and fewer
   typos always rank above more.
3. **A query token matched nothing** - the candidate is rejected. AND across tokens, never OR: a
   search for "jean dupont" returning every Jean is a search that ignored half of what was typed.

Three decisions inside that are worth stating, because each was measurable and none is obvious:

- **Matching token-to-token is what buys word inversion**, and buys it for free. The old matcher
  compared the WHOLE query against each haystack word, so "dupont jean" found nothing at all
  against "Jean Dupont" - the single most common way somebody types a name.
- **A transposition costs ONE edit** (`editDistance` is Damerau-Levenshtein, not plain
  Levenshtein). Swapping two adjacent letters is the most common typo there is, and plain
  Levenshtein prices it at two substitutions - the same as a genuinely different name. Under a
  tolerance of one edit that is the difference between "jaen" finding Jean and not finding him,
  and loosening the tolerance to two instead would have matched everything else at distance two.
- **The tolerance ladder is the ecosystem's, and it was measured rather than chosen.** Tolerance is
  taken from the SHORTER of the two tokens compared: **0 up to 3 characters, 1 from 4 to 7, 2 from
  8**. Against a real roster of 207 people, a tolerance of 2 below eight characters recovered no
  typo that a tolerance of 1 did not - every single-keystroke fault is one edit by construction -
  while putting a wrong name in the list on half of all queries instead of one in twenty. This
  repository used to allow 2 from five characters, which is exactly that case. Three characters get
  nothing at all, because at one edit they reach most of a promotion; that rung is survivable
  because a three-letter query is nearly always a PREFIX, and a prefix is free regardless -
  somebody typing "dupon" has not made a mistake, they have stopped typing.

  The numbers, the measurement and what every other repository owes are in the canari repository at
  `docs/wiki/search-contract.md`. Change them there, not here.

## The surfaces

| Where                              | Haystack                                                            | Ranked |
| ---------------------------------- | ------------------------------------------------------------------- | ------ |
| `lib/components/AlbumModal.svelte` | the share dropdown: id, name, first, last                           | yes    |
| `routes/parametres/+page.svelte`   | the permission-target dropdown: name, first, last, formation, promo | yes    |
| `routes/admin/users/+page.svelte`  | name, first, last, formation, promo, role label                     | yes    |
| `routes/albums/+page.svelte`       | album name + location                                               | no     |

**A list that TRUNCATES must rank.** The share dropdown caps at 8, which is where ranking stopped
being cosmetic: truncating an unordered filter throws the best match away as readily as the worst,
so a name spelled slightly differently from what was typed was not ranked low, it was unreachable.

**`/albums` deliberately does not**, and `fuzzyMatch` there is the right call rather than an
oversight: the grid buckets albums by school year and then by month and shows every match, so there
is no truncation for a relevance order to rescue - reordering would only scramble the chronology
inside a month. It still gets the typo and word-inversion tolerance; only the sort is declined.

## What is deliberately NOT fuzzy

**The admin log search** (`routes/admin/logs/+page.server.ts`) is SQL `LIKE` over `actor`,
`target_id`, `target_type` and `details`, and stays that way. It is not a name search: those fields
hold ids and event types, somebody searching a log has an exact string in hand, and edit-distance
matching there would return neighbouring ids as if they were the one asked for - the opposite of
what an audit trail is for.
