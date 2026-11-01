import { m } from '#lib/paraglide/messages.js';

/**
 * What a member reads when a photo listing fails. The server types its failure by status: 502 and
 * 504 are Immich unreachable or too slow (nothing the member did, and a retry later works), shown
 * as one plain sentence; anything else keeps its own text.
 */
export function photosFailureMessage(status: number, fallbackText: string): string {
  if (status === 502 || status === 504) {
    return m.photos_upstream_busy();
  }
  return m.photos_error({ message: fallbackText });
}
