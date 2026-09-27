import { describe, expect, it } from 'vitest';
import { isNavActive } from '$lib/nav-items';

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
