/**
 * The content security policy, read by `vite.config.ts` (SvelteKit's `csp` option, which adds a
 * hash for each inline script it writes) and by the tests.
 *
 * TWO STAGES. `directives` is ENFORCED now. `reportOnly` is OBSERVED for one release: nothing in
 * it blocks anything, and every violation a browser sees is posted to `CSP_REPORT_PATH` and logged
 * (`noteCspReport`). Once the log of a release is quiet, its entries move to `directives`.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { sveltekit } from '@sveltejs/kit/vite';

/** SvelteKit's own type for the `csp` option. */
type KitCsp = NonNullable<Parameters<typeof sveltekit>[0]>['csp'];

/** Where a browser posts what the report-only policy would have blocked. */
export const CSP_REPORT_PATH = '/api/csp-report';

/**
 * The hash source of each inline `<script>` that `src/app.html` itself carries (the theme set
 * before the first paint). SvelteKit hashes the scripts it writes, never the ones of the template,
 * so they are read from the file here and cannot drift from it.
 */
export function appHtmlScriptHashes(html: string): `sha256-${string}`[] {
  // Any casing, any attribute, any spacing of the closing tag: a script this missed would simply
  // not be listed. One with a `src` has no body to hash and is covered by its origin.
  return [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script[^>]*>/gi)]
    .filter((match) => match[1].trim() !== '')
    .map(
      (match): `sha256-${string}` =>
        `sha256-${createHash('sha256').update(match[1]).digest('base64')}`
    );
}

const templateScripts = appHtmlScriptHashes(
  readFileSync(new URL('./src/app.html', import.meta.url), 'utf8')
);

export const CSP = {
  mode: 'auto',
  directives: {
    // No other site may display this one in a frame (the modern form of X-Frame-Options).
    // `/auth/handoff` answers its own, stricter `frame-ancestors 'none'` (hooks.server.ts).
    'frame-ancestors': ['self'],
  },
  reportOnly: {
    'default-src': ['self'],
    // SvelteKit adds the hash of each inline script it writes; the template's theme script is
    // listed here.
    'script-src': ['self', ...templateScripts],
    // Svelte writes `style` attributes (transitions, computed positions): inline styles stay.
    // fonts.googleapis.com serves the stylesheet of the Inter and Space Grotesk web fonts.
    'style-src': ['self', 'unsafe-inline', 'https://fonts.googleapis.com'],
    // Photos and thumbnails come through `/api/immich/...`, so they are same-origin; `data:` and
    // `blob:` are the crops, previews and canvases built in the browser.
    'img-src': ['self', 'data:', 'blob:'],
    // fonts.gstatic.com serves the font files that stylesheet names.
    'font-src': ['self', 'data:', 'https://fonts.gstatic.com'],
    // Every request the app makes is to its own API.
    'connect-src': ['self'],
    // Videos and the camera capture play from same-origin streams or `blob:` URLs.
    'media-src': ['self', 'blob:'],
    'object-src': ['none'],
    'base-uri': ['self'],
    'form-action': ['self'],
    'report-uri': [CSP_REPORT_PATH],
  },
} satisfies KitCsp;
