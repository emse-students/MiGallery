/**
 * The audit log keeps 90 days and records the client address from ONE trusted source.
 *
 * What it pins: `purgeOldLogs` deletes exactly the rows past the retention, and `logEvent` takes
 * the address from SvelteKit's getClientAddress() - adapter-bun's ADDRESS_HEADER in production -
 * never from X-Forwarded-For, whose first value is whatever the client sent.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeTempDir } from './test-helpers';

vi.mock('#lib/server/auth.ts', () => ({ getRequestSession: () => null }));

let logs: typeof import('#lib/server/logs.ts');
let database: typeof import('#lib/db/database.ts');
let dbDir: string;

beforeAll(async () => {
  dbDir = mkdtempSync(join(tmpdir(), 'migallery-logs-'));
  process.env.DATABASE_PATH = join(dbDir, 'logs.db');
  database = await import('#lib/db/database.ts');
  logs = await import('#lib/server/logs.ts');
});

afterAll(() => {
  database.resetDatabase();
  removeTempDir(dbDir);
});

beforeEach(() => {
  database.getDatabase().exec('DELETE FROM logs');
});

describe('purgeOldLogs', () => {
  it('deletes the rows older than the retention and keeps the rest', () => {
    const db = database.getDatabase();
    const add = db.prepare(
      "INSERT INTO logs (event_type, timestamp) VALUES (?, datetime('now', ?))"
    );
    add.run('old', `-${logs.LOG_RETENTION_DAYS + 1} days`);
    add.run('edge', `-${logs.LOG_RETENTION_DAYS * 24 - 1} hours`);
    add.run('new', '-1 hours');

    expect(logs.purgeOldLogs()).toBe(1);
    const left = db.prepare('SELECT event_type FROM logs ORDER BY id').all();
    expect(left).toEqual([{ event_type: 'edge' }, { event_type: 'new' }]);
  });
});

describe('logEvent ip', () => {
  const lastIp = () =>
    (database.getDatabase().prepare('SELECT ip FROM logs ORDER BY id DESC').get() as { ip: string })
      .ip;

  it('records getClientAddress() and ignores a client-written X-Forwarded-For', () => {
    const event = {
      request: new Request('http://x/', { headers: { 'x-forwarded-for': '6.6.6.6, 10.0.0.1' } }),
      getClientAddress: () => '203.0.113.7',
    };
    logs.logEvent(event as never, 'test');
    expect(lastIp()).toBe('203.0.113.7');
  });

  it('records no address, rather than a guessed one, when none is available', () => {
    const event = {
      request: new Request('http://x/', { headers: { 'x-forwarded-for': '6.6.6.6' } }),
      getClientAddress: () => {
        throw new Error('Address header was specified but is absent from request');
      },
    };
    logs.logEvent(event as never, 'test');
    expect(lastIp()).toBeNull();
  });
});
