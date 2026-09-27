import { describe, expect, it } from 'vitest';
import { parsePreference, resolveTheme } from '$lib/theme-preference';

describe('parsePreference', () => {
  it('keeps the three known choices', () => {
    expect(parsePreference('light')).toBe('light');
    expect(parsePreference('dark')).toBe('dark');
    expect(parsePreference('system')).toBe('system');
  });

  it('reads nothing, or anything unknown, as system', () => {
    expect(parsePreference(null)).toBe('system');
    expect(parsePreference('sepia')).toBe('system');
  });
});

describe('resolveTheme', () => {
  it('follows the device only for system', () => {
    expect(resolveTheme('system', true)).toBe('light');
    expect(resolveTheme('system', false)).toBe('dark');
    expect(resolveTheme('dark', true)).toBe('dark');
    expect(resolveTheme('light', false)).toBe('light');
  });
});
