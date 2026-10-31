import { json, error, isHttpError } from '@sveltejs/kit';
import { ensureError } from '#lib/ts-utils.ts';
import type { RequestHandler } from './$types';
import { requireScope } from '#lib/server/permissions.ts';
import { resetDatabase } from '#lib/db/database.ts';
import fs from 'fs';
import path from 'path';

import { createLogger } from '#lib/server/logger.ts';
import { logRouteFailure, readFormBody } from '#lib/server/route-errors.ts';

const log = createLogger('admin-db-import');
export const POST: RequestHandler = async (event) => {
  await requireScope(event, 'admin');

  const { request } = event;

  try {
    const formData = await readFormBody(request);
    const file = formData.get('file') as File | null;

    if (!file) {
      return error(400, 'Missing file. Please provide a file.');
    }

    if (typeof file === 'string' || !file.name) {
      return error(400, 'Invalid file.');
    }

    if (!file.name.endsWith('.db')) {
      return error(400, 'Invalid file. Please provide a .db file.');
    }

    const DB_PATH = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'migallery.db');
    const BACKUP_PATH = `${DB_PATH}.before-import.${Date.now()}`;

    resetDatabase();

    try {
      fs.copyFileSync(DB_PATH, BACKUP_PATH);
    } catch (backupError) {
      if ((backupError as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw backupError;
      }
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(DB_PATH, buffer);

    return json({
      success: true,
      message: 'Database imported successfully',
      backup: BACKUP_PATH,
    });
  } catch (e: unknown) {
    logRouteFailure(log, 'POST /api/admin/db-import', e);
    if (isHttpError(e)) {
      throw e;
    }
    // The file was accepted and could not be written: the server's fault, not the client's.
    const err = ensureError(e);
    return error(500, `The database could not be imported: ${err.message}`);
  }
};
