import { env } from '#lib/server/env.ts';
import { createLogger } from '#lib/server/logger.ts';

const log = createLogger('immich-config');

/**
 * Immich is not configured on this server (`IMMICH_BASE_URL` is empty). A deliberate state, not a
 * failure: the test suite runs without Immich by contract (`scripts/test-with-server.mjs`).
 * Classified where it is known, so a route answers 503 without accusing anything, while a REAL
 * failure to reach or read Immich keeps its error line.
 */
export class ImmichNotConfiguredError extends Error {
  readonly kind = 'immich_not_configured';
  constructor() {
    super('Immich is not configured (IMMICH_BASE_URL is empty)');
    this.name = 'ImmichNotConfiguredError';
  }
}

let said = false;

/**
 * Immich's base URL, or {@link ImmichNotConfiguredError} when there is none. The state is said
 * once per process, at info: it does not change while the server runs.
 */
export function requireImmichBaseUrl(): string {
  const base = env.IMMICH_BASE_URL;
  if (!base) {
    if (!said) {
      said = true;
      log.info('Immich is not configured: requests that need it answer 503');
    }
    throw new ImmichNotConfiguredError();
  }
  return base;
}
