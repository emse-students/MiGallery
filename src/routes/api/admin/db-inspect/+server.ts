import { json } from '@sveltejs/kit';
import { ensureError } from '$lib/ts-utils';
import type { RequestHandler } from './$types';
import { requireScope } from '$lib/server/permissions';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';

import { getDatabase } from '$lib/db/database';
import { createLogger } from '$lib/server/logger';

const log = createLogger('admin-db-inspect');
const execFileAsync = promisify(execFile);

export const GET: RequestHandler = async (event) => {
  await requireScope(event, 'admin');

  try {
    const scriptPath = path.join(process.cwd(), 'scripts', 'inspect-db.cjs');
    // `process.execPath`, not a literal interpreter name: the child MUST run on the same runtime
    // as this server. inspect-db.cjs opens the database through `bun:sqlite`, which no other
    // interpreter can resolve, and a PATH lookup would let the container's environment decide.
    const { stdout: output } = await execFileAsync(process.execPath, [scriptPath], {
      encoding: 'utf-8',
    });

    const hasErrors = output.includes('❌');
    const errors = hasErrors ? ['See the logs for more details'] : [];

    const db = getDatabase();
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {
      name: string;
    }[];

    return json({
      success: !hasErrors,
      hasErrors,
      errors,
      output,
      tables: tables.map((t) => t.name),
    });
  } catch (e: unknown) {
    const err = ensureError(e);
    const errOutput = e && typeof e === 'object' && 'stdout' in e ? String(e.stdout) : err.message;

    // This branch cannot stay silent. It is reached BOTH when the inspection ran and reported a
    // damaged database, and when the child never ran at all (wrong interpreter, missing script) -
    // two causes the response body cannot tell apart, because it says the same thing for each.
    log.error('Inspection failed', { message: err.message, output: errOutput });

    return json({
      success: false,
      hasErrors: true,
      errors: ['Errors detected in the database'],
      output: errOutput,
    });
  }
};
