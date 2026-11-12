/**
 * The `Cache-Control` the server hook gives a response, decided in one place.
 *
 * WHO A RESPONSE WAS MADE FOR DECIDES WHO MAY KEEP IT. A file of the build is the same for
 * everyone and never changes under its name; a page is rendered for the member who asked for it
 * (their name, their albums, their rights), so nothing between the server and that member may
 * keep it, and the browser asks again each time.
 */

/** Files of the build, and static pictures and fonts: the same bytes for everyone, for two days. */
const SHARED_FOR_TWO_DAYS = 'public, max-age=172800, immutable';

/** A page rendered for one member. */
const FOR_THIS_MEMBER_ONLY = 'private, no-store';

/** A public file that may change under its name (`robots.txt`, the manifest): always re-asked. */
const SHARED_AND_REVALIDATED = 'public, max-age=0, must-revalidate';

const STATIC_FILE = /\.(png|jpg|jpeg|gif|webp|svg|woff|woff2|ttf|eot)$/i;

/**
 * The policy for the response to `pathname`, or `null` when the route's own policy stands.
 *
 * - `/api/...`: `null`. An API route knows what it serves (a member's photo is `private`), and it
 *   keeps what it set whatever its path ends with.
 * - `/_app/...` and static pictures and fonts: shared and immutable for two days.
 * - an HTML document: for this member only, never stored.
 * - anything else: shared, re-asked every time.
 *
 * @param contentType - the response's `Content-Type`, which is what tells a page from a file
 */
export function cacheControlFor(pathname: string, contentType: string | null): string | null {
  if (pathname.startsWith('/api/')) return null;
  if (pathname.includes('/_app/') || STATIC_FILE.test(pathname)) return SHARED_FOR_TWO_DAYS;
  if ((contentType ?? '').toLowerCase().startsWith('text/html')) return FOR_THIS_MEMBER_ONLY;
  return SHARED_AND_REVALIDATED;
}
