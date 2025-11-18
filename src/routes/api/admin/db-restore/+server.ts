import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDatabase } from '$lib/db/database';
import { verifySigned } from '$lib/auth/cookies';
import type { User } from '$lib/db/database';
import fs from 'fs';
import path from 'path';

async function getUserFromLocals(locals: any, cookies: any): Promise<User | null> {
	const db = getDatabase();
	const cookieSigned = cookies.get('current_user_id');
	if (cookieSigned) {
		const verified = verifySigned(cookieSigned);
		if (verified) {
			const userInfo = db.prepare("SELECT * FROM users WHERE id_user = ? LIMIT 1").get(verified) as User | null;
			if (userInfo) return userInfo;
		}
	}
	if (locals && typeof locals.auth === 'function') {
		const session = await locals.auth();
		if (session?.user) {
			const providerId = (session.user as any).id || (session.user as any).preferred_username || (session.user as any).sub;
			if (providerId) {
				const userInfo = db.prepare("SELECT * FROM users WHERE id_user = ? LIMIT 1").get(providerId) as User | null;
				if (userInfo) return userInfo;
			}
		}
	}
	return null;
}

export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	const user = await getUserFromLocals(locals, cookies);
	
	if (!user?.role || user.role !== 'admin') {
		throw error(403, 'Accès refusé');
	}

	try {
		const { filename } = await request.json();

		if (!filename) {
			throw error(400, 'Nom de fichier manquant');
		}

		const BACKUP_DIR = process.env.BACKUP_DIR || path.join(process.cwd(), 'data', 'backups');
		const backupPath = path.join(BACKUP_DIR, filename);

		if (!fs.existsSync(backupPath)) {
			throw error(404, 'Fichier de sauvegarde non trouvé');
		}

		// Vérifier que le fichier est bien dans le dossier backups (sécurité)
		const realBackupPath = fs.realpathSync(backupPath);
		const realBackupDir = fs.realpathSync(BACKUP_DIR);
		
		if (!realBackupPath.startsWith(realBackupDir)) {
			throw error(403, 'Accès refusé au fichier');
		}

		const DB_PATH = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'migallery.db');
		const SAFETY_BACKUP = DB_PATH + '.before-restore.' + Date.now();

		// Sauvegarder la DB actuelle
		if (fs.existsSync(DB_PATH)) {
			fs.copyFileSync(DB_PATH, SAFETY_BACKUP);
		}

		// Restaurer depuis la sauvegarde
		fs.copyFileSync(backupPath, DB_PATH);

		return json({
			success: true,
			message: 'Sauvegarde restaurée avec succès',
			safetyBackup: SAFETY_BACKUP
		});
	} catch (err: any) {
		console.error('Error restoring backup:', err);
		throw error(500, err.message || 'Erreur lors de la restauration');
	}
};
