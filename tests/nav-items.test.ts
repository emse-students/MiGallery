import { describe, expect, it } from 'vitest';
import { NAV_ITEMS, isNavActive } from '$lib/nav-items';
import { locales } from '$lib/paraglide/runtime';

describe('isNavActive', () => {
  it('lights a section on its own page and below it', () => {
    expect(isNavActive('/albums', '/albums')).toBe(true);
    expect(isNavActive('/albums/abc', '/albums')).toBe(true);
  });

  it('does not light a section on a sibling that shares its prefix', () => {
    expect(isNavActive('/albums-archive', '/albums')).toBe(false);
    expect(isNavActive('/mes-photos', '/albums')).toBe(false);
  });
});

describe('NAV_ITEMS names', () => {
  // The phone's bottom bar draws the glyph alone (Instagram's bar), so each tab's name is only its
  // accessible name: invisible, and therefore the one thing no screenshot would catch missing.
  it.each(locales)('gives every destination a non-empty name in %s', (locale) => {
    for (const item of NAV_ITEMS) {
      expect(item.label({}, { locale }).trim()).not.toBe('');
    }
  });
});
