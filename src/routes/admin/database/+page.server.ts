import { error } from '@sveltejs/kit';

import { ensureError } from '$lib/ts-utils';
import type { PageServerLoad } from './$types';
import { getDatabase } from '$lib/db/database';
import fs from 'fs';
import path from 'path';

export const load: PageServerLoad = async ({ parent }) => {
	const { session } = await parent();
	const user = session?.user;
	if (!user?.role || user.role !== 'admin') {
		throw error(403, 'Accès refusé');
	}

	const db = getDatabase();

	// Statistiques de la DB
	const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
	const albumCount = db.prepare('SELECT COUNT(*) as count FROM albums').get() as { count: number };
	const adminCount = db.prepare("SELECT COUNT(*) as count FROM users WHERE role='admin'").get() as {
		count: number;
	};

	// Taille de la DB
	const DB_PATH = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'migallery.db');
	let dbSize = '0 KB';
	try {
		const stats = fs.statSync(DB_PATH);
		const sizeKB = stats.size / 1024;
		if (sizeKB < 1024) {
			dbSize = `${sizeKB.toFixed(2)} KB`;
		} else {
			dbSize = `${(sizeKB / 1024).toFixed(2)} MB`;
		}
	} catch (e: unknown) {
		const _err = ensureError(e);
		console.error('Error getting DB size:', e);
	}

	// Liste des sauvegardes
	const BACKUP_DIR = process.env.BACKUP_DIR || path.join(process.cwd(), 'data', 'backups');
	let backups: Array<{ filename: string; date: string; size: string }> = [];

	try {
		if (fs.existsSync(BACKUP_DIR)) {
			const files = fs
				.readdirSync(BACKUP_DIR)
				.filter((f) => f.startsWith('migallery_backup_') && f.endsWith('.db'))
				.map((f) => {
					const filePath = path.join(BACKUP_DIR, f);
					const stats = fs.statSync(filePath);
					const sizeKB = stats.size / 1024;
					return {
						filename: f,
						date: new Date(stats.mtime).toLocaleString('fr-FR'),
						size: sizeKB < 1024 ? `${sizeKB.toFixed(2)} KB` : `${(sizeKB / 1024).toFixed(2)} MB`,
						time: stats.mtime
					};
				})
				.sort((a, b) => b.time.getTime() - a.time.getTime())
				.slice(0, 10);

			backups = files.map(({ filename, date, size }) => ({ filename, date, size }));
		}
	} catch (e: unknown) {
		const _err = ensureError(e);
		console.error('Error listing backups:', e);
	}

	return {
		stats: {
			users: userCount.count,
			albums: albumCount.count,
			admins: adminCount.count,
			size: dbSize
		},
		backups
	};
};
