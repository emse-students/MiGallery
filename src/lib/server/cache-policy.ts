/**
 * The `Cache-Control` the server hook gives a response, decided in one place.
 *
 * WHO A RESPONSE WAS MADE FOR DECIDES WHO MAY KEEP IT, AND THE DEFAULT IS "THIS MEMBER ONLY". A
 * page, the `__data.json` that carries its data, a redirect that depends on who asked: each is an
 * answer to one person, so nothing between the server and that person may keep it. Only what is on
 * the list below is the same for everyone - and only when it was actually served.
 */

/** Files of the build, and static pictures and fonts: the same bytes for everyone, for two days. */
const SHARED_FOR_TWO_DAYS = 'public, max-age=172800, immutable';

/** An answer made for one member: a page, its data, a redirect, an error. */
const FOR_THIS_MEMBER_ONLY = 'private, no-store';

/** A public file that may change under its name: always re-asked. */
const SHARED_AND_REVALIDATED = 'public, max-age=0, must-revalidate';

const STATIC_FILE = /\.(png|jpg|jpeg|gif|webp|svg|ico|woff|woff2|ttf|eot)$/i;

/** The public files that keep their name while their content changes. */
const REVALIDATED_FILES = new Set(['/robots.txt', '/manifest.webmanifest']);

/**
 * The policy for the response to `pathname`, or `null` when the route's own policy stands.
 *
 * - `/api/...`: `null`. An API route knows what it serves (a member's photo is `private`), and it
 *   keeps what it set whatever its path ends with.
 * - `/_app/...` and static pictures and fonts, SERVED (2xx, or the 304 that confirms a copy):
 *   shared and immutable for two days. A 404 on such a path is not a file and is not labelled one.
 * - `robots.txt` and the manifest, served: shared, re-asked every time.
 * - everything else - a page, `__data.json`, a redirect, an error: for this member only, never
 *   stored.
 *
 * @param status - the response's status: only a served file is a file
 */
export function cacheControlFor(pathname: string, status: number): string | null {
  if (pathname.startsWith('/api/')) return null;
  const served = (status >= 200 && status < 300) || status === 304;
  if (served && (pathname.startsWith('/_app/') || STATIC_FILE.test(pathname))) {
    return SHARED_FOR_TWO_DAYS;
  }
  if (served && REVALIDATED_FILES.has(pathname)) return SHARED_AND_REVALIDATED;
  return FOR_THIS_MEMBER_ONLY;
}
