/**
 * The ONE `href` validator of the app, shared by the Markdown renderer (`#lib/docs/render-md.ts`)
 * and the translation parser (`#lib/rich-text.ts`).
 *
 * A browser strips tabs and newlines inside a URL and ignores leading C0 controls and spaces, and
 * reads `/\host` as `//host`; so `<java\tscript:...>` or `\x01javascript:` would run although a
 * naive scheme test sees no scheme. The rule is therefore "refuse the characters", not "normalise
 * then test": any control, whitespace or backslash anywhere in the value rejects it.
 */

/**
 * True for a character no href may contain: C0 controls and space (tab, LF, CR included), DEL and
 * the C1 controls, any Unicode whitespace (NBSP, U+2028, U+3000...), the zero-width and bidi marks
 * (U+200B..U+200F) and the backslash. Spelled with code points, not an escaped regex class, so no
 * editor, formatter or tool can turn an escape into a literal character.
 */
function isForbiddenChar(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return (
    code <= 0x20 ||
    (code >= 0x7f && code <= 0xa0) ||
    code === 0x5c ||
    (code >= 0x200b && code <= 0x200f) ||
    /\s/.test(ch)
  );
}

/** The schemes a link may carry. */
const SCHEMES = ['http', 'https', 'mailto'];

export interface SafeHrefOptions {
  /** Also accept a relative reference (`./page.md`, `page.md`, `?q=1`). Default: site path or `#` only. */
  relative?: boolean;
}

/**
 * True when `href` is http(s), mailto, an in-page `#anchor`, a site path (`/x`, never `//` and never
 * `/\`) or, with `relative`, a relative reference.
 */
export function isSafeHref(href: string, options: SafeHrefOptions = {}): boolean {
  if (href === '' || [...href].some(isForbiddenChar)) {
    return false;
  }
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(href);
  if (scheme) {
    return SCHEMES.includes(scheme[1].toLowerCase());
  }
  if (href.startsWith('//')) {
    return false;
  }
  if (href.startsWith('/') || href.startsWith('#')) {
    return true;
  }
  return options.relative === true;
}
