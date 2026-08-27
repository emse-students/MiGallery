/**
 * Small text-matching utilities for typo-, accent- and word-order-tolerant search.
 * Kept dependency-free so it can be reused by any search field.
 *
 * The contract is the one every search box in the ecosystem answers to: a query tolerates typos and
 * word inversion, and results are RANKED by how close they are rather than merely filtered. Canari
 * gets that from Postgres (`applyFuzzyNameSearch`, pg_trgm + unaccent) because its directory is a
 * table it queries; Sky, Le Cercle, Portail-etu and MiGallery filter in memory over a list already
 * loaded, so they score in TypeScript. See `docs/wiki/search.md`, and the ecosystem-wide contract
 * in canari at `docs/wiki/search-contract.md` - which is where the tolerance ladder below comes
 * from and where the measurement that produced it is written down.
 */

/** Lowercase + strip diacritics (e -> e) for accent/case-insensitive matching. */
export function normalizeText(s: string | null | undefined): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim();
}

/**
 * Edit distance between two strings, counting a TRANSPOSITION as one edit
 * (Damerau-Levenshtein, optimal string alignment; iterative, three-row).
 *
 * Transposition is the most common typo there is - "jaen" for "jean", "Duptno" for "Dupont" - and
 * plain Levenshtein charges it TWO substitutions, which is the same price as a genuinely different
 * name. Under a tolerance of one edit that difference is the whole behaviour: swapping two adjacent
 * letters made a name unfindable, and no amount of loosening the tolerance fixes it without also
 * matching everything else at distance two.
 */
export function editDistance(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  if (!a.length) {
    return b.length;
  }
  if (!b.length) {
    return a.length;
  }

  // Three rows rather than two: the transposition case reads the row BEFORE the previous one.
  let prev2 = new Array<number>(b.length + 1);
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, prev2[j - 2] + 1);
      }
      curr[j] = best;
    }
    [prev2, prev, curr] = [prev, curr, prev2];
  }
  return prev[b.length];
}

/**
 * Edit distance still tolerated inside one token, by the length of the SHORTER of the two compared.
 *
 * The ecosystem's ladder, measured rather than chosen: against a roster of 207 people, a tolerance
 * of 2 below eight characters recovered no typo that a tolerance of 1 did not - every single
 * keystroke fault is one edit by construction - while offering nearly one WRONG name per query
 * instead of one every fourteen. The rung at 4 is a deliberate loss: three characters carry no
 * information, and a three-character query is nearly always a prefix, which the tier above catches
 * before this one is reached.
 *
 * Taken from the shorter token so a short query cannot buy itself two edits against a long
 * surname - at that ratio the tolerance matches most of the roster.
 */
function tokenTolerance(shorter: number): number {
  if (shorter <= 3) {
    return 0;
  }

  return shorter <= 7 ? 1 : 2;
}

/**
 * How well `query` matches `haystack`. LOWER is a better match; `null` means it does not match.
 *
 * An empty query scores 0 and matches everything, so a caller may sort unconditionally and still
 * get the list's natural order back when the box is empty.
 *
 * Three tiers, in order of how literally the reader meant it:
 *
 * 1. **The whole query appears verbatim** - scored by WHERE it appears, so "mar" ranks "Marie"
 *    above "Omar". This is the common case and it stays cheap.
 * 2. **Every query token matches some haystack token**, by substring or by a small edit distance.
 *    Matching token-to-token rather than query-to-string is what buys word inversion for free:
 *    "dupont jean" and "jean dupont" walk the same tokens in a different order. Each token adds
 *    `10 + distance`, so any token match ranks below every verbatim hit, and a two-typo match ranks
 *    below a one-typo match.
 * 3. **A query token matched nothing** - the candidate is rejected outright. AND across tokens,
 *    never OR: a search for "jean dupont" that returned every Jean would be a search that ignored
 *    half of what was typed.
 */
export function fuzzyScore(query: string, haystack: string): number | null {
  const q = normalizeText(query);
  if (!q) {
    return 0;
  }
  const h = normalizeText(haystack);

  const idx = h.indexOf(q);
  if (idx >= 0) {
    return idx;
  }

  const hayTokens = h.split(/\s+/).filter((t) => t.length > 0);
  const queryTokens = q.split(/\s+/).filter((t) => t.length > 0);
  let total = 0;
  for (const qt of queryTokens) {
    let best = Infinity;
    for (const ht of hayTokens) {
      // A prefix counts as exact: somebody typing "dupon" has not made a mistake, they have
      // stopped typing. Edit distance would have charged them for the letters they did not type.
      if (ht.includes(qt)) {
        best = 0;
        break;
      }
      const tolerance = tokenTolerance(Math.min(qt.length, ht.length));
      if (tolerance === 0) {
        continue;
      }
      const d = editDistance(qt, ht);
      if (d <= tolerance && d < best) {
        best = d;
      }
    }
    if (best === Infinity) {
      return null;
    }
    total += 10 + best;
  }
  return total;
}

/**
 * Typo-, accent- and word-order-tolerant match of `query` against `haystack`.
 *
 * The boolean face of {@link fuzzyScore}, for a caller that genuinely only filters. Anything
 * showing a bounded number of results should score and SORT instead - a list truncated to eight
 * entries by insertion order throws the best match away as readily as the worst.
 */
export function fuzzyMatch(query: string, haystack: string): boolean {
  return fuzzyScore(query, haystack) !== null;
}

/**
 * Keeps the items matching `query` and orders them best-first.
 *
 * The one helper every search box here calls, so ranking cannot be the thing a surface forgets.
 * Ties keep their original relative order (the index is the tiebreaker), so an empty query gives
 * the list back exactly as it came - alphabetical, chronological, whatever the caller had already
 * decided.
 *
 * @param items    The list to search.
 * @param query    What the user typed; empty keeps everything, in order.
 * @param haystack Builds the searchable text for one item - every field worth matching, joined.
 */
export function fuzzySearch<T>(
  items: readonly T[],
  query: string,
  haystack: (item: T) => string
): T[] {
  if (!normalizeText(query)) {
    return items.slice();
  }
  const scored: { item: T; score: number; index: number }[] = [];
  items.forEach((item, index) => {
    const score = fuzzyScore(query, haystack(item));
    if (score !== null) {
      scored.push({ item, score, index });
    }
  });
  scored.sort((a, b) => a.score - b.score || a.index - b.index);
  return scored.map((s) => s.item);
}
