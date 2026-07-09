/**
 * Small text-matching utilities for typo- and accent-tolerant search.
 * Kept dependency-free so it can be reused by any search field.
 */

/** Lowercase + strip diacritics (e -> e) for accent/case-insensitive matching. */
export function normalizeText(s: string | null | undefined): string {
	return (s || '')
		.toLowerCase()
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.trim();
}

/** Levenshtein edit distance between two strings (iterative, two-row). */
export function levenshtein(a: string, b: string): number {
	if (a === b) {
		return 0;
	}
	if (!a.length) {
		return b.length;
	}
	if (!b.length) {
		return a.length;
	}

	let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
	let curr = new Array<number>(b.length + 1);

	for (let i = 1; i <= a.length; i++) {
		curr[0] = i;
		for (let j = 1; j <= b.length; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
		}
		[prev, curr] = [curr, prev];
	}
	return prev[b.length];
}

/**
 * Typo- and accent-tolerant match of `query` against `haystack`.
 * Matches when the normalized haystack contains the normalized query, or when
 * any word in the haystack is within a small edit distance of the query.
 */
export function fuzzyMatch(query: string, haystack: string): boolean {
	const q = normalizeText(query);
	if (!q) {
		return true;
	}
	const h = normalizeText(haystack);
	if (h.includes(q)) {
		return true;
	}

	const threshold = q.length <= 3 ? 1 : q.length <= 6 ? 2 : 3;
	for (const word of h.split(/\s+/)) {
		if (!word) {
			continue;
		}
		if (levenshtein(q, word) <= threshold) {
			return true;
		}
		// Tolerate typos against the start of a longer word (e.g. "dupon" ~ "dupont").
		if (word.length > q.length && levenshtein(q, word.slice(0, q.length)) <= threshold) {
			return true;
		}
	}
	return false;
}
