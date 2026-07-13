import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireScope } from '$lib/server/permissions';
import { performBackup } from '$lib/server/backup';

import { createLogger } from '$lib/server/logger';

const log = createLogger('admin-db-backup');
export const POST: RequestHandler = async (event) => {
	await requireScope(event, 'admin');

	const result = performBackup();

	if (!result.success) {
		log.error('Manual backup failed:', result.message);
		throw error(500, result.message);
	}

	return json({
		success: true,
		message: result.message,
		backupPath: result.backupPath
	});
};
