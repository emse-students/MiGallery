/**
 * A client error is not a server fault: `logRouteFailure` logs an HttpError under 500 as a WARNING
 * naming the route and the status, and keeps a 5xx or a plain throw at ERROR. The body readers
 * turn a body the client sent wrong into a 400; a duplicate key is read from SQLite's typed code.
 */

import { describe, it, expect, vi } from 'vitest';
import { error, isHttpError } from '@sveltejs/kit';
import {
  isUniqueViolation,
  logRouteFailure,
  readFormBody,
  readJsonBody,
} from '#lib/server/route-errors.ts';

function fakeLog() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function thrown(fn: () => never): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  return null;
}

describe('logRouteFailure', () => {
  it('logs a client error (4xx) as a warning naming the route and the status', () => {
    for (const status of [400, 401, 404, 409, 499]) {
      const log = fakeLog();
      logRouteFailure(
        log,
        'GET /api/x',
        thrown(() => error(status, 'nope'))
      );
      expect(log.error).not.toHaveBeenCalled();
      expect(log.warn).toHaveBeenCalledWith(`GET /api/x: refused ${status}`, { message: 'nope' });
    }
  });

  it('keeps a server fault (5xx, or anything that is not an HttpError) at error', () => {
    for (const e of [
      thrown(() => error(500, 'boom')),
      thrown(() => error(503, 'x')),
      new Error('y'),
    ]) {
      const log = fakeLog();
      logRouteFailure(log, 'POST /api/x', e);
      expect(log.warn).not.toHaveBeenCalled();
      expect(log.error).toHaveBeenCalledWith('POST /api/x', e);
    }
  });
});

describe('the body readers', () => {
  it('answer 400 on a body that is not JSON, and read one that is', async () => {
    const bad = await readJsonBody(new Request('http://x/', { method: 'POST', body: '{' })).catch(
      (e: unknown) => e
    );
    expect(isHttpError(bad) && bad.status).toBe(400);
    const good = await readJsonBody<{ a: number }>(
      new Request('http://x/', { method: 'POST', body: '{"a":1}' })
    );
    expect(good).toEqual({ a: 1 });
  });

  it('answer 400 on a body that is not a form', async () => {
    const bad = await readFormBody(new Request('http://x/', { method: 'POST', body: 'x' })).catch(
      (e: unknown) => e
    );
    expect(isHttpError(bad) && bad.status).toBe(400);
  });
});

describe('isUniqueViolation', () => {
  it('reads the driver code, never the message', () => {
    expect(isUniqueViolation({ code: 'SQLITE_CONSTRAINT_UNIQUE' })).toBe(true);
    expect(isUniqueViolation({ code: 'SQLITE_CONSTRAINT_PRIMARYKEY' })).toBe(true);
    expect(isUniqueViolation({ code: 'SQLITE_CONSTRAINT_FOREIGNKEY' })).toBe(false);
    expect(isUniqueViolation(new Error('UNIQUE constraint failed: users.id_user'))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});
