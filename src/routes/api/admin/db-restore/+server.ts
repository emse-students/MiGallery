import { json, error, isHttpError } from '@sveltejs/kit';
import { ensureError } from '#lib/ts-utils.ts';
import type { RequestHandler } from './$types';
import { requireScope } from '#lib/server/permissions.ts';
import { resetDatabase } from '#lib/db/database.ts';
import fs from 'fs';
import path from 'path';

import { createLogger } from '#lib/server/logger.ts';
import { logRouteFailure, readJsonBody } from '#lib/server/route-errors.ts';

const log = createLogger('admin-db-restore');
export const POST: RequestHandler = async (event) => {
  await requireScope(event, 'admin');

  const { request } = event;

  try {
    const { filename } = await readJsonBody<{ filename?: string }>(request);

    if (!filename) {
      throw error(400, 'Missing filename');
    }

    const BACKUP_DIR = process.env.BACKUP_DIR || path.join(process.cwd(), 'data', 'backups');
    const backupPath = path.join(BACKUP_DIR, filename);

    if (!fs.existsSync(backupPath)) {
      throw error(404, 'Backup file not found');
    }

    const realBackupPath = fs.realpathSync(backupPath);
    const realBackupDir = fs.realpathSync(BACKUP_DIR);

    if (!realBackupPath.startsWith(realBackupDir)) {
      throw error(403, 'File access denied');
    }

    const DB_PATH = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'migallery.db');
    const SAFETY_BACKUP = `${DB_PATH}.before-restore.${Date.now()}`;

    resetDatabase();

    if (fs.existsSync(DB_PATH)) {
      fs.copyFileSync(DB_PATH, SAFETY_BACKUP);
    }

    fs.copyFileSync(backupPath, DB_PATH);

    return json({
      success: true,
      message: 'Backup restored successfully',
      safetyBackup: SAFETY_BACKUP,
    });
  } catch (e: unknown) {
    logRouteFailure(log, 'POST /api/admin/db-restore', e);
    // A refusal (400 no filename, 403 outside the backups, 404 no such file) keeps its status.
    if (isHttpError(e)) {
      throw e;
    }
    const err = ensureError(e);
    throw error(500, err.message || 'Error during restore');
  }
};
