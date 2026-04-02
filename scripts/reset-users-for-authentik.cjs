#!/usr/bin/env node
/**
 * SCRIPT DE MIGRATION UNIQUE - Passage CAS → Authentik (MiConnect)
 * ================================================================
 * Ce script supprime TOUS les utilisateurs existants de la base de données.
 * Il est nécessaire car les identifiants changent :
 *   - Avant : ID CAS (ex: "jsmith123")
 *   - Après : UUID Authentik (ex: "550e8400-e29b-41d4-a716-446655440000")
 *
 * Les utilisateurs devront se reconnecter via MiConnect après l'exécution.
 * Leurs associations photos (id_photos) seront perdues et devront être reconfigurées.
 *
 * ATTENTION : Action irréversible. Une sauvegarde est faite automatiquement.
 *
 * Usage :
 *   node ./scripts/reset-users-for-authentik.cjs
 *   node ./scripts/reset-users-for-authentik.cjs --dry-run
 */

const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'migallery.db');

if (!fs.existsSync(DB_PATH)) {
	console.error('❌ Base de données non trouvée:', DB_PATH);
	process.exit(1);
}

const isDryRun = process.argv.includes('--dry-run');

if (isDryRun) {
	console.log('🔍 Mode DRY-RUN : aucune modification ne sera appliquée.\n');
}

let Database;
try {
	Database = require('bun:sqlite').Database;
} catch {
	Database = require('better-sqlite3');
}

const db = new Database(DB_PATH);

// Compter les entités avant suppression
const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
const permCount = db.prepare('SELECT COUNT(*) as count FROM album_user_permissions').get().count;
const favCount = db.prepare('SELECT COUNT(*) as count FROM user_favorites').get().count;
const accessCount = db
	.prepare('SELECT COUNT(*) as count FROM photo_access_permissions')
	.get().count;

console.log('📊 État actuel de la base de données :');
console.log(`   👥 Utilisateurs            : ${userCount}`);
console.log(`   🔐 Permissions albums       : ${permCount}`);
console.log(`   ❤️  Favoris                 : ${favCount}`);
console.log(`   📸 Permissions photos       : ${accessCount}`);
console.log('');

if (userCount === 0) {
	console.log('✅ La table users est déjà vide. Rien à faire.');
	process.exit(0);
}

if (isDryRun) {
	console.log('🔍 DRY-RUN : les suppression ci-dessus seraient effectuées.');
	console.log('   Relancez sans --dry-run pour appliquer.');
	process.exit(0);
}

// Sauvegarde automatique
const backupPath = DB_PATH + '.before-authentik-migration.' + Date.now();
fs.copyFileSync(DB_PATH, backupPath);
console.log(`💾 Sauvegarde créée : ${path.basename(backupPath)}\n`);

// Suppression en cascade (les FK en SQLite ne sont pas actives par défaut,
// on supprime dans le bon ordre)
try {
	db.exec('BEGIN TRANSACTION');

	db.exec('DELETE FROM photo_access_permissions');
	console.log(`   ✅ photo_access_permissions vidé (${accessCount} entrées)`);

	db.exec('DELETE FROM user_favorites');
	console.log(`   ✅ user_favorites vidé (${favCount} entrées)`);

	db.exec('DELETE FROM album_user_permissions');
	console.log(`   ✅ album_user_permissions vidé (${permCount} entrées)`);

	db.exec('DELETE FROM users');
	console.log(`   ✅ users vidé (${userCount} entrées)`);

	db.exec('COMMIT');
	console.log('\n✅ Migration terminée avec succès.');
	console.log('   Les utilisateurs devront se reconnecter via MiConnect (Authentik).');
} catch (err) {
	db.exec('ROLLBACK');
	console.error('❌ Erreur lors de la migration, rollback effectué :', err.message);
	process.exit(1);
}

db.close();
