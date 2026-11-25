import type { Handle } from '@sveltejs/kit/hooks';
import interstitialHtml from '../leaveInAppBrowser/interstitial.html?raw';
import { leaveInAppBrowserResponse, type GateRequest } from '../leaveInAppBrowser/gate';

/**
 * This site's use of the ecosystem's shared Meta in-app browser gate (owner decision of
 * 2026-11-25, Canari's docs/wiki/frontend/leaving-in-app-browsers.md): a page request from the
 * browser built into Messenger, Facebook, Instagram or Threads is answered with one blocking page
 * that sends the visitor to the system browser, and nothing of this site is served inside it.
 * Null lets the request through.
 *
 * The three files under `../leaveInAppBrowser/` are VENDORED byte-identically from Canari's
 * `libs/leave-in-app-browser/`: never edit them here, change the source and copy it again. The
 * interstitial is the one user-visible text outside Paraglide, on purpose: the same bytes are
 * served on every site and in front of MiConnect's identity provider, where no Paraglide exists.
 */
export function leaveInAppBrowser(request: GateRequest, url: URL): Response | null {
  return leaveInAppBrowserResponse(request, url, {
    html: interstitialHtml,
    site: 'migallery',
    log: (line) => console.log(line),
  });
}

/** The SvelteKit `handle` step, FIRST in the sequence so no session, locale or page head is built. */
export const leaveInAppBrowserHandler: Handle = ({ event, resolve }) =>
  leaveInAppBrowser(event.request, event.url) ?? resolve(event);
