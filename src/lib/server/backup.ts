import fs from 'fs';
import path from 'path';

const DB_PATH = process.env.DATABASE_PATH ?? path.join(process.cwd(), 'data', 'migallery.db');
const BACKUP_DIR = process.env.BACKUP_DIR ?? path.join(process.cwd(), 'data', 'backups');

const MAX_BACKUPS = 10;
const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 heures

export interface BackupResult {
	success: boolean;
	backupPath?: string;
	message: string;
}

/**
 * Effectue une sauvegarde de la base de données SQLite.
 * Copie le fichier DB vers data/backups/ et conserve les MAX_BACKUPS dernières sauvegardes.
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

		// Rotation : supprimer les sauvegardes excédentaires
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
				// Ignorer les erreurs de suppression d'anciennes sauvegardes
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
 * Démarre le planificateur de sauvegarde automatique.
 * La première sauvegarde se déclenche à minuit, puis toutes les 24 h.
 * Idempotent : n'enregistre qu'une seule instance de planificateur.
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
			console.warn('[BACKUP]', result.message);
		} else {
			console.error('[BACKUP]', result.message);
		}
	};

	setTimeout(() => {
		runAndSchedule();
		setInterval(runAndSchedule, BACKUP_INTERVAL_MS);
	}, msUntilMidnight);

	const hUntil = Math.round(msUntilMidnight / 3_600_000);
	console.warn(`[BACKUP] Planificateur démarré — prochaine sauvegarde dans ~${hUntil}h (minuit)`);
}
