import fs from 'fs';
import path from 'path';
import { createLogger } from '$lib/server/logger';

const log = createLogger('backup');

const DB_PATH = process.env.DATABASE_PATH ?? path.join(process.cwd(), 'data', 'migallery.db');
const BACKUP_DIR = process.env.BACKUP_DIR ?? path.join(process.cwd(), 'data', 'backups');

const MAX_BACKUPS = 10;
const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface BackupResult {
	success: boolean;
	backupPath?: string;
	message: string;
}

/**
 * Performs a backup of the SQLite database.
 * Copies the DB file to data/backups/ and keeps the last MAX_BACKUPS backups.
 */
export function performBackup(): BackupResult {
	if (!fs.existsSync(DB_PATH)) {
		return { success: false, message: `Base de données non trouvée : ${DB_PATH}` };
	}

	try {
		fs.mkdirSync(BACKUP_DIR, { recursive: true });

		const now = new Date();
		const date = now.toISOString().split('T')[0];
		const time = now.toTimeString().split(' ')[0].replace(/:/g, '-');
		const backupFileName = `migallery_backup_${date}_${time}.db`;
		const backupPath = path.join(BACKUP_DIR, backupFileName);

		fs.copyFileSync(DB_PATH, backupPath);

		// Rotation: delete the excess backups
		const backups = fs
			.readdirSync(BACKUP_DIR)
			.filter((f) => f.startsWith('migallery_backup_') && f.endsWith('.db'))
			.map((f) => ({
				name: f,
				filePath: path.join(BACKUP_DIR, f),
				mtimeMs: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs
			}))
			.sort((a, b) => b.mtimeMs - a.mtimeMs);

		backups.slice(MAX_BACKUPS).forEach((b) => {
			try {
				fs.unlinkSync(b.filePath);
			} catch {
				// Ignore errors when deleting old backups
			}
		});

		return { success: true, backupPath, message: `Sauvegarde créée : ${backupFileName}` };
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		return { success: false, message: `Erreur lors de la sauvegarde : ${msg}` };
	}
}

let schedulerStarted = false;

/**
 * Starts the automatic backup scheduler.
 * The first backup triggers at midnight, then every 24 h.
 * Idempotent: registers only a single scheduler instance.
 */
export function startBackupScheduler(): void {
	if (schedulerStarted) {
		return;
	}
	schedulerStarted = true;

	const now = new Date();
	const nextMidnight = new Date(now);
	nextMidnight.setDate(nextMidnight.getDate() + 1);
	nextMidnight.setHours(0, 0, 0, 0);
	const msUntilMidnight = nextMidnight.getTime() - now.getTime();

	const runAndSchedule = () => {
		const result = performBackup();
		if (result.success) {
			log.info(result.message);
		} else {
			log.error(result.message);
		}
	};

	setTimeout(() => {
		runAndSchedule();
		setInterval(runAndSchedule, BACKUP_INTERVAL_MS);
	}, msUntilMidnight);

	const hUntil = Math.round(msUntilMidnight / 3_600_000);
	log.info(`scheduler started - next backup in ~${hUntil}h (midnight)`);
}
