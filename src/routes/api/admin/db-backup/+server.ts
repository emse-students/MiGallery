import { json, error } from '@sveltejs/kit';
import { ensureError } from '$lib/ts-utils';
import type { RequestHandler } from './$types';
import { requireScope } from '$lib/server/permissions';
import { execSync } from 'child_process';
import path from 'path';

export const POST: RequestHandler = async (event) => {
	await requireScope(event, 'admin');

	try {
		const scriptPath = path.join(process.cwd(), 'scripts', 'backup-db.cjs');
		const output = execSync(`node "${scriptPath}"`, { encoding: 'utf-8' });

		const match = output.match(/Sauvegarde créée:\s*(.+)/);
		const backupFileName = match ? match[1].trim() : null;
		const backupPath = backupFileName
			? path.join(process.cwd(), 'data', 'backups', backupFileName)
			: null;

		return json({
			success: true,
			message: 'Sauvegarde créée avec succès',
			backupPath,
			output
		});
	} catch (e: unknown) {
		const err = ensureError(e);
		console.error('Error running backup:', err);
		throw error(500, err.message || 'Erreur lors de la sauvegarde');
	}
};
