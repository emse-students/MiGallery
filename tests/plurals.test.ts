import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  albumd_photo_count,
  db_covers_prune_done,
  trash_items_in_bin,
} from '$lib/paraglide/messages';

/**
 * Counts read as sentences, never "photo(s)": every counted message is a plural variant
 * (inlang message-format, `count: plural`). French puts 0 and 1 in the singular, English only 1.
 */

describe('counted messages agree with their count', () => {
  it('French: 0 and 1 are singular, 2 and more plural', () => {
    expect(albumd_photo_count({ count: 0 }, { locale: 'fr' })).toBe('0 photo');
    expect(albumd_photo_count({ count: 1 }, { locale: 'fr' })).toBe('1 photo');
    expect(albumd_photo_count({ count: 2956 }, { locale: 'fr' })).toBe('2956 photos');
  });

  it('English: only 1 is singular', () => {
    expect(albumd_photo_count({ count: 0 }, { locale: 'en' })).toBe('0 photos');
    expect(albumd_photo_count({ count: 1 }, { locale: 'en' })).toBe('1 photo');
  });

  it('agrees the whole sentence, not just the noun', () => {
    expect(db_covers_prune_done({ deleted: 1, size: '2 Ko' }, { locale: 'fr' })).toBe(
      '1 couverture supprimée, 2 Ko libérés'
    );
    expect(trash_items_in_bin({ count: 3 }, { locale: 'fr' })).toBe('éléments dans la corbeille');
  });

  it('leaves no "(s)" in either catalogue', () => {
    for (const locale of ['fr', 'en']) {
      expect(readFileSync(`messages/${locale}.json`, 'utf-8')).not.toContain('(s)');
    }
  });
});
