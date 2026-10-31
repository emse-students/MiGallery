/**
 * An `import` audit row is authorisation state (asset-uploads.ts), so a failed write of one is
 * reported at error; any other row that fails stays a warning. The database is made to refuse
 * every insert.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const emitted = vi.hoisted(() => ({ lines: [] as Array<{ level: string; message: string }> }));

vi.mock('#lib/server/auth.ts', () => ({ getRequestSession: () => null }));
vi.mock('#lib/db/database.ts', () => ({
  getDatabase: () => ({
    prepare: () => ({
      run: () => {
        throw new Error('database is locked');
      },
    }),
  }),
}));
vi.mock('#lib/server/logger.ts', () => ({
  createLogger: () => ({
    debug: (message: string) => emitted.lines.push({ level: 'debug', message }),
    info: (message: string) => emitted.lines.push({ level: 'info', message }),
    warn: (message: string) => emitted.lines.push({ level: 'warn', message }),
    error: (message: string) => emitted.lines.push({ level: 'error', message }),
  }),
}));

const { logEvent } = await import('#lib/server/logs.ts');

beforeEach(() => {
  emitted.lines = [];
});

describe('logEvent when the write fails', () => {
  it('reports a lost import row at error', () => {
    logEvent(null, 'import', 'asset', 'a1', { duplicate: false });
    expect(emitted.lines.map((l) => l.level)).toEqual(['error']);
  });

  it('keeps any other lost row at warn', () => {
    logEvent(null, 'update', 'asset', 'a1', null);
    expect(emitted.lines.map((l) => l.level)).toEqual(['warn']);
  });
});
