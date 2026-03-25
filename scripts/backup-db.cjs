#!/usr/bin/env node
/**
 * Script de sauvegarde de la base de données
 * - Sauvegarde automatique quotidienne à minuit (via cron ou tâche planifiée)
 * - Conserve les 10 dernières sauvegardes
 * - Peut être appelé manuellement
 */

const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'migallery.db');
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(process.cwd(), 'data', 'backups');
const MAX_BACKUPS = 10;

console.log('🔄 Démarrage de la sauvegarde de la base de données...');

if (!fs.existsSync(DB_PATH)) {
	console.error('❌ Base de données non trouvée:', DB_PATH);
	process.exit(1);
}

if (!fs.existsSync(BACKUP_DIR)) {
	fs.mkdirSync(BACKUP_DIR, { recursive: true });
	console.log('📁 Dossier de sauvegarde créé:', BACKUP_DIR);
}

// Générer le nom du fichier de sauvegarde avec timestamp
const timestamp =
	new Date().toISOString().replace(/[:.]/g, '-').split('T')[0] +
	'_' +
	new Date().toTimeString().split(' ')[0].replace(/:/g, '-');
const backupFileName = `migallery_backup_${timestamp}.db`;
const backupPath = path.join(BACKUP_DIR, backupFileName);

try {
	fs.copyFileSync(DB_PATH, backupPath);
	console.log('✅ Sauvegarde créée:', backupFileName);

	const backups = fs
		.readdirSync(BACKUP_DIR)
		.filter((f) => f.startsWith('migallery_backup_') && f.endsWith('.db'))
		.map((f) => ({
			name: f,
			path: path.join(BACKUP_DIR, f),
			time: fs.statSync(path.join(BACKUP_DIR, f)).mtime
		}))
		.sort((a, b) => b.time - a.time); // Trier par date décroissante

	console.log(`📊 Total des sauvegardes: ${backups.length}`);

	// Supprimer les anciennes sauvegardes si on dépasse MAX_BACKUPS
	if (backups.length > MAX_BACKUPS) {
		const toDelete = backups.slice(MAX_BACKUPS);
		console.log(`🗑️  Suppression de ${toDelete.length} ancienne(s) sauvegarde(s)...`);

		toDelete.forEach((backup) => {
			fs.unlinkSync(backup.path);
			console.log(`   - ${backup.name}`);
		});

		console.log(`✅ Sauvegardes anciennes supprimées. ${MAX_BACKUPS} sauvegardes conservées.`);
	}

	console.log('\n✨ Sauvegarde terminée avec succès !');
	console.log(`📍 Emplacement: ${backupPath}`);
	console.log(`📦 Taille: ${(fs.statSync(backupPath).size / 1024).toFixed(2)} KB`);
} catch (error) {
	console.error('❌ Erreur lors de la sauvegarde:', error.message);
	process.exit(1);
}
