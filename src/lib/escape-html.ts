/**
 * Escapes a value for use inside a double-quoted HTML attribute, or as text between tags.
 *
 * Ported from Canari (`frontend/src/lib/utils/escapeHtml.ts`). Load-bearing wherever markup is
 * built as a string and set as `innerHTML`: member names and ids arrive from the API, and `"`
 * alone is enough to leave an attribute, `<` to leave a tag. `&` goes first so the entities added
 * after it are not double-encoded; `'` and a backtick are escaped because some attribute parsers
 * take them as delimiters.
 */
export function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/`/g, '&#96;');
}
