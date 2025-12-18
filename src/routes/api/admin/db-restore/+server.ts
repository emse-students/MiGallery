import { json, error } from '@sveltejs/kit';
import { ensureError } from '$lib/ts-utils';
import type { RequestHandler } from './$types';
import { requireScope } from '$lib/server/permissions';
import { resetDatabase } from '$lib/db/database';
import fs from 'fs';
import path from 'path';

export const POST: RequestHandler = async (event) => {
	await requireScope(event, 'admin');

	const { request } = event;

	try {
		const { filename } = (await request.json()) as { filename?: string };

		if (!filename) {
			throw error(400, 'Nom de fichier manquant');
		}

		const BACKUP_DIR = process.env.BACKUP_DIR || path.join(process.cwd(), 'data', 'backups');
		const backupPath = path.join(BACKUP_DIR, filename);

		if (!fs.existsSync(backupPath)) {
			throw error(404, 'Fichier de sauvegarde non trouvé');
		}

		const realBackupPath = fs.realpathSync(backupPath);
		const realBackupDir = fs.realpathSync(BACKUP_DIR);

		if (!realBackupPath.startsWith(realBackupDir)) {
			throw error(403, 'Accès refusé au fichier');
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
			message: 'Sauvegarde restaurée avec succès',
			safetyBackup: SAFETY_BACKUP
		});
	} catch (e: unknown) {
		const err = ensureError(e);
		console.error('Error restoring backup:', err);
		throw error(500, err.message || 'Erreur lors de la restauration');
	}
};
