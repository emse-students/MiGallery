/*
 * The theme rules, free of SvelteKit imports so a test can load them; `theme.ts` is the store.
 * `app.html`'s inline script repeats `parsePreference` + `resolveTheme` - keep the two in step.
 */

/** What the page is painted in. `app.css` keys on `data-theme="light"`; dark is the default. */
export type Theme = 'light' | 'dark';

/** What the user chose. `system` follows the device's `prefers-color-scheme`, live. */
export type ThemePreference = Theme | 'system';

export const THEME_STORAGE_KEY = 'theme';

/**
 * Reads a stored preference. Anything unknown - nothing stored, or a value from an older build -
 * is `system`: the device's own choice is the only default that is right for everybody.
 */
export function parsePreference(stored: string | null): ThemePreference {
  return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
}

/** The theme a preference paints, given whether the device currently prefers light. */
export function resolveTheme(pref: ThemePreference, deviceLight: boolean): Theme {
  if (pref === 'system') return deviceLight ? 'light' : 'dark';
  return pref;
}
