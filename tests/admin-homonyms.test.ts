/**
 * The admin list's homonym rule (`#lib/admin-homonyms.ts`, Canari's D56): two shown rows identical
 * in folded name, promo and formation carry the first 8 characters of their id; a row told apart
 * by its promo or its formation (both already shown) carries nothing more.
 */
import { describe, it, expect } from 'vitest';
import { homonymIdHints } from '#lib/admin-homonyms.ts';

const row = (id_user: string, name: string, promo: number | null, formation: string | null) => ({
  id_user,
  name,
  promo,
  formation,
});

describe('homonymIdHints', () => {
  it('two rows identical in name, promo and formation show different id prefixes', () => {
    const hints = homonymIdHints([
      row('aaaaaaaa1111', 'Bea Martin', 2019, 'ICM'),
      row('bbbbbbbb2222', 'Béa  martin', 2019, 'icm'),
      row('cccccccc3333', 'Alex Durand', 2019, 'ICM'),
    ]);
    expect(hints.get('aaaaaaaa1111')).toBe('aaaaaaaa');
    expect(hints.get('bbbbbbbb2222')).toBe('bbbbbbbb');
    expect(hints.has('cccccccc3333')).toBe(false);
  });

  it('a promo or a formation that differs is enough: no id shown', () => {
    const hints = homonymIdHints([
      row('a1', 'Bea Martin', 2019, 'ICM'),
      row('b2', 'Bea Martin', 2020, 'ICM'),
      row('c3', 'Bea Martin', 2019, 'ISMIN'),
    ]);
    expect(hints.size).toBe(0);
  });

  it('only the rows shown are compared, and a row with no name is never grouped', () => {
    expect(homonymIdHints([row('a1', 'Bea Martin', 2019, 'ICM')]).size).toBe(0);
    expect(homonymIdHints([row('a1', '', null, null), row('b2', '', null, null)]).size).toBe(0);
  });
});
