/**
 * Typo-, accent- and word-order-tolerant search (`src/lib/fuzzy.ts`).
 *
 * Pure functions, no server needed. What this pins is the contract every search box in the
 * ecosystem answers to - typos, word inversion, and RANKING by closeness - because the failure it
 * replaces was invisible: a matcher that returns a boolean looks correct while quietly handing a
 * truncated list its worst eight results.
 */

import { describe, it, expect } from 'vitest';
import { fuzzyScore, fuzzyMatch, fuzzySearch, normalizeText, editDistance } from '$lib/fuzzy';

describe('normalizeText', () => {
  it('folds case and accents so a French name is reachable from a bare keyboard', () => {
    expect(normalizeText('  Amélie  ')).toBe('amelie');
    expect(normalizeText('ÉCOLE')).toBe('ecole');
    expect(normalizeText(null)).toBe('');
  });
});

describe('editDistance', () => {
  it('counts single-character edits', () => {
    expect(editDistance('dupont', 'dupond')).toBe(1);
    expect(editDistance('dupont', 'dupont')).toBe(0);
    expect(editDistance('', 'abc')).toBe(3);
  });

  it('charges ONE edit for two swapped letters, not two', () => {
    // The most common typo there is. Plain Levenshtein prices it the same as a different name,
    // which under a tolerance of one edit makes the name simply unfindable.
    expect(editDistance('jaen', 'jean')).toBe(1);
    expect(editDistance('duptno', 'dupton')).toBe(1);
  });
});

describe('fuzzyScore', () => {
  it('matches everything on an empty query, neutrally', () => {
    expect(fuzzyScore('', 'anything at all')).toBe(0);
    expect(fuzzyScore('   ', 'anything at all')).toBe(0);
  });

  it('ranks an earlier verbatim hit above a later one', () => {
    const marie = fuzzyScore('mar', 'Marie Dupont')!;
    const omar = fuzzyScore('mar', 'Omar Dupont')!;

    expect(marie).toBeLessThan(omar);
  });

  it('tolerates a typo', () => {
    expect(fuzzyScore('dupond', 'Jean Dupont')).not.toBeNull();
    expect(fuzzyScore('amelei', 'Amelie Martin')).not.toBeNull();
  });

  it('tolerates word inversion, which the old matcher did not', () => {
    // The whole query is one token to a substring check, so "dupont jean" found nothing at all
    // against "Jean Dupont" - the single most common way somebody types a name.
    expect(fuzzyScore('dupont jean', 'Jean Dupont')).not.toBeNull();
    expect(fuzzyScore('jean dupont', 'Jean Dupont')).not.toBeNull();
  });

  it('tolerates both at once', () => {
    expect(fuzzyScore('dupond jaen', 'Jean Dupont')).not.toBeNull();
  });

  it('ranks a verbatim hit above any token match', () => {
    const verbatim = fuzzyScore('jean dupont', 'Jean Dupont')!;
    const inverted = fuzzyScore('dupont jean', 'Jean Dupont')!;

    expect(verbatim).toBeLessThan(inverted);
  });

  it('ranks fewer typos above more', () => {
    // Long enough a token that two edits are still inside the ladder - at six characters they
    // are not, deliberately, which is what the tolerance tests below pin.
    const one = fuzzyScore('dupontler', 'Jean Dupontier')!;
    const two = fuzzyScore('dupontlar', 'Jean Dupontier')!;

    expect(one).toBeLessThan(two);
  });

  it('treats a prefix as exact rather than charging for the untyped letters', () => {
    // Somebody typing "dupon" has not made a mistake, they have stopped typing - so an
    // unfinished token must score exactly as well as the finished one.
    expect(fuzzyScore('dupon jean', 'Jean Dupont')).toBe(fuzzyScore('dupont jean', 'Jean Dupont'));
    expect(fuzzyScore('dupon', 'Jean Dupont')).not.toBeNull();
  });

  it('REJECTS a candidate that misses one of the query tokens', () => {
    // AND across tokens: a search for "jean dupont" that returned every Jean would be a search
    // that ignored half of what was typed.
    expect(fuzzyScore('jean dupont', 'Jean Martin')).toBeNull();
    expect(fuzzyScore('marie 2024', 'Marie Dupont')).toBeNull();
  });

  /**
   * The ecosystem's tolerance ladder, measured against a real roster and written down in canari at
   * `docs/wiki/search-contract.md`: OSA distance, tolerance taken from the SHORTER of the two
   * tokens, 0 up to 3 characters, 1 from 4 to 7, 2 from 8. These three tests are the same three
   * every repo in the ecosystem pins, and they are the contract - not an observation about this
   * implementation.
   */
  describe('the tolerance ladder', () => {
    it('gives a token of three characters or fewer no edit at all', () => {
      // Three letters carry no information: at one edit "ana" reaches "anne", "ana" and half a
      // promotion besides. Measured cost of that rung: nearly one wrong name per query.
      expect(fuzzyScore('ana', 'Anne Dupont')).toBeNull();
      expect(fuzzyScore('ana', 'Jean Dupont')).toBeNull();
      // A prefix is free, which is what makes the rung survivable - a three-letter query is
      // almost always somebody who has stopped typing, and that never reaches the fuzzy tier.
      expect(fuzzyScore('ann', 'Anne Dupont')).not.toBeNull();
    });

    it('gives one edit from four characters, transposition included', () => {
      expect(fuzzyScore('jaen', 'Jean Dupont')).not.toBeNull();
      expect(fuzzyScore('dupond', 'Jean Dupont')).not.toBeNull();
    });

    it('refuses a SECOND edit below eight characters', () => {
      // The measured heart of the ladder: every single-keystroke fault is one edit, so the
      // second recovers nothing and offers a wrong name on half of all queries.
      expect(fuzzyScore('dupand', 'Jean Dupont')).toBeNull();
      expect(fuzzyScore('marlon', 'Marion Dupont')).not.toBeNull();
    });

    it('allows two edits from eight characters, where a name can carry two faults', () => {
      expect(fuzzyScore('dupontlar', 'Jean Dupontier')).not.toBeNull();
    });

    it('takes the tolerance from the SHORTER token, never the longer', () => {
      // Otherwise a short query buys itself the tolerance of whatever long name it is compared
      // against, at which ratio the tolerance matches most of the roster - the same as not
      // filtering at all. Both of these would match if the rung were read off the candidate.
      expect(fuzzyScore('jen', 'Jean Dupont')).toBeNull();
      expect(fuzzyScore('dupontr', 'Jean Dupontier')).toBeNull();
    });
  });

  it('searches every field the caller joined, not just the name', () => {
    expect(fuzzyScore('2024', 'Marie Dupont ICM 2024')).not.toBeNull();
    expect(fuzzyScore('icm marie', 'Marie Dupont ICM 2024')).not.toBeNull();
  });
});

describe('fuzzyMatch', () => {
  it('is the boolean face of the score', () => {
    expect(fuzzyMatch('dupont jean', 'Jean Dupont')).toBe(true);
    expect(fuzzyMatch('martin', 'Jean Dupont')).toBe(false);
    expect(fuzzyMatch('', 'Jean Dupont')).toBe(true);
  });
});

describe('fuzzySearch', () => {
  const people = [
    { name: 'Omar Dupont' },
    { name: 'Jean Martin' },
    { name: 'Marie Dupont' },
    { name: 'Amelie Bernard' },
  ];
  const hay = (p: { name: string }) => p.name;

  it('gives the list back untouched on an empty query', () => {
    expect(fuzzySearch(people, '', hay)).toEqual(people);
    expect(fuzzySearch(people, '  ', hay)).toEqual(people);
  });

  it('orders best-first rather than by position in the source list', () => {
    // Marie is third in the roster; nothing but ranking puts her in front of Omar.
    const found = fuzzySearch(people, 'mar', hay).map((p) => p.name);

    expect(found[0]).toBe('Marie Dupont');
    expect(found).toContain('Omar Dupont');
  });

  it('drops what does not match at all', () => {
    expect(fuzzySearch(people, 'dupont', hay).map((p) => p.name)).toEqual([
      'Omar Dupont',
      'Marie Dupont',
    ]);
  });

  it('keeps the source order between equally good matches', () => {
    // Stability is what makes an alphabetical or chronological list still readable under search.
    const found = fuzzySearch(people, 'dupont', hay).map((p) => p.name);

    expect(found.indexOf('Omar Dupont')).toBeLessThan(found.indexOf('Marie Dupont'));
  });

  it('does not mutate what it was given', () => {
    const before = people.map((p) => p.name);
    fuzzySearch(people, 'mar', hay);

    expect(people.map((p) => p.name)).toEqual(before);
  });
});
