import { writable } from 'svelte/store';
import { browser } from '$app/environment';

import {
  parsePreference,
  resolveTheme,
  THEME_STORAGE_KEY,
  type Theme,
  type ThemePreference,
} from '$lib/theme-preference';

export type { Theme, ThemePreference };

function deviceLight(): boolean {
  return browser && window.matchMedia('(prefers-color-scheme: light)').matches;
}

/** The theme currently painted, for a control that offers the opposite (the top-bar toggle). */
export const paintedTheme = writable<Theme>('dark');

function apply(pref: ThemePreference): void {
  const resolved = resolveTheme(pref, deviceLight());
  if (browser) document.documentElement.setAttribute('data-theme', resolved);
  paintedTheme.set(resolved);
}

/**
 * The user's theme preference, persisted in localStorage. `app.html` applies the same rule in an
 * inline script before the first paint (a store only runs after hydration, which painted a light
 * user dark for a frame); `initialize` then keeps a `system` preference in step with the device.
 */
function createThemeStore() {
  const initial = parsePreference(browser ? localStorage.getItem(THEME_STORAGE_KEY) : null);
  const { subscribe, set } = writable<ThemePreference>(initial);
  let current = initial;

  function choose(pref: ThemePreference) {
    current = pref;
    if (browser) localStorage.setItem(THEME_STORAGE_KEY, pref);
    apply(pref);
    set(pref);
  }

  return {
    subscribe,
    set: choose,
    /** Flips what is painted (the signed-out top-bar button), which pins an explicit choice. */
    toggle: () => choose(resolveTheme(current, deviceLight()) === 'light' ? 'dark' : 'light'),
    initialize: () => {
      if (!browser) return;
      apply(current);
      window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
        if (current === 'system') apply(current);
      });
    },
  };
}

export const theme = createThemeStore();
