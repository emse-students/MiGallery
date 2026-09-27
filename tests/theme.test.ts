import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parsePreference, resolveTheme, THEME_COLORS } from '$lib/theme-preference';

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

describe('THEME_COLORS', () => {
  // The same two values live in four files; this is what keeps them in step.
  const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

  it("is each theme's --bg-primary in app.css", () => {
    const css = read('src/app.css');
    const dark = css.slice(css.indexOf(':root {')).match(/--bg-primary:\s*(#[0-9a-f]+)/i)?.[1];
    const light = css
      .slice(css.indexOf("[data-theme='light'] {"))
      .match(/--bg-primary:\s*(#[0-9a-f]+)/i)?.[1];
    expect(dark).toBe(THEME_COLORS.dark);
    expect(light).toBe(THEME_COLORS.light);
  });

  it("is the manifest's theme colour and app.html's first-paint values", () => {
    const manifest = JSON.parse(read('static/manifest.webmanifest'));
    expect(manifest.theme_color).toBe(THEME_COLORS.dark);
    const html = read('src/app.html');
    expect(html).toContain(`<meta name="theme-color" content="${THEME_COLORS.dark}" />`);
    expect(html).toContain(`t === 'light' ? '${THEME_COLORS.light}' : '${THEME_COLORS.dark}'`);
  });
});
