import { describe, expect, it } from 'vitest';
import { NAV_ITEMS, isNavActive, navBadgeCount } from '#lib/nav-items.ts';
import { locales } from '#lib/paraglide/runtime.js';

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

describe('navBadgeCount', () => {
  it('badges only "Mes photos", with the faces waiting for an answer', () => {
    expect(navBadgeCount('/mes-photos', 473)).toBe(473);
    expect(navBadgeCount('/albums', 473)).toBe(0);
    expect(navBadgeCount('/parametres', 5)).toBe(0);
  });

  it('shows nothing for none, an unknown count or a negative one', () => {
    expect(navBadgeCount('/mes-photos', 0)).toBe(0);
    expect(navBadgeCount('/mes-photos', undefined)).toBe(0);
    expect(navBadgeCount('/mes-photos', -1)).toBe(0);
  });
});
