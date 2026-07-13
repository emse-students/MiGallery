import { json, error } from '@sveltejs/kit';
import { ensureError } from '$lib/ts-utils';
import type { RequestHandler } from './$types';
import { requireScope } from '$lib/server/permissions';
import { resetDatabase } from '$lib/db/database';
import fs from 'fs';
import path from 'path';

import { createLogger } from '$lib/server/logger';

const log = createLogger('admin-db-import');
export const POST: RequestHandler = async (event) => {
	await requireScope(event, 'admin');

	const { request } = event;

	try {
		const formData = await request.formData();
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
			backup: BACKUP_PATH
		});
	} catch (e: unknown) {
		const err = ensureError(e);
		log.error('Error importing database:', err);
		return error(400, 'Invalid file. The database could not be imported.');
	}
};
