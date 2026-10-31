import { error, isHttpError } from '@sveltejs/kit';
import type { Logger } from '#lib/server/logger.ts';

/**
 * Log a route's failure at the level its CLASS deserves. The class is decided where the failure
 * was thrown: an `HttpError` under 500 is the CLIENT's (a missing field, a bad id, no session, a
 * forged state), so it is a warning naming the route and the status - the request was refused, the
 * server is fine. Anything else (a 5xx, or a plain throw) is a server fault and stays an error.
 */
export function logRouteFailure(log: Logger, where: string, e: unknown): void {
  if (isHttpError(e) && e.status < 500) {
    log.warn(`${where}: refused ${e.status}`, { message: e.body.message });
    return;
  }
  log.error(where, e);
}

/**
 * The request's JSON body, or a 400 when it is not JSON: a body the client sent wrong is the
 * client's error, classified here rather than surfacing as a 500 from a later `JSON.parse` throw.
 */
export async function readJsonBody<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw error(400, 'The request body is not valid JSON');
  }
}

/** The request's form data, or a 400 when the body is not a readable form (same reason). */
export async function readFormBody(request: Request): Promise<FormData> {
  try {
    return await request.formData();
  } catch {
    throw error(400, 'The request body is not a valid form');
  }
}

/**
 * Whether `e` is SQLite refusing a duplicate key (UNIQUE or PRIMARY KEY), read from the driver's
 * typed `code` rather than its message: a duplicate the client asked for is a 409, not a fault.
 */
export function isUniqueViolation(e: unknown): boolean {
  const code = (e as { code?: unknown } | null)?.code;
  return code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT_PRIMARYKEY';
}
