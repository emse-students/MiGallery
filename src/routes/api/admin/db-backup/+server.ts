import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireScope } from '$lib/server/permissions';
import { performBackup } from '$lib/server/backup';

export const POST: RequestHandler = async (event) => {
	await requireScope(event, 'admin');

	const result = performBackup();

	if (!result.success) {
		console.error('[BACKUP] Manual backup failed:', result.message);
		throw error(500, result.message);
	}

	return json({
		success: true,
		message: result.message,
		backupPath: result.backupPath
	});
};
