#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function isBunRuntime() {
	return typeof Bun !== 'undefined';
}

let Database;
if (isBunRuntime()) {
	Database = require('bun:sqlite').Database;
} else {
	Database = require('better-sqlite3');
}

const DB_PATH = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'migallery.db');
const REPAIR_MODE = process.argv.includes('--repair');
const SYSTEM_USER_ID = 'dd68bb5b4f7c56878a1bd873593a3e7c3434242c80871e4ead9fe99d3f48a782';

console.log('🔍 Inspection de la base de données...');
console.log('📍 Emplacement:', DB_PATH);
console.log('');

if (!fs.existsSync(DB_PATH)) {
	console.error('❌ Base de données non trouvée:', DB_PATH);
	console.log('\n💡 Utilisez "npm run db:init" pour créer une nouvelle base de données.');
	process.exit(1);
}

let hasErrors = false;
const errors = [];

// Inspection
let db;
try {
	if (isBunRuntime()) {
		// Bun:sqlite options are slightly different or more sensitive
		db = new Database(DB_PATH, REPAIR_MODE ? { readwrite: true } : { readonly: true });
	} else {
		db = new Database(DB_PATH, { readonly: !REPAIR_MODE });
	}
} catch (e) {
	console.error(`❌ Impossible d'ouvrir la base de données: ${e.message}`);
	process.exit(1);
}

try {
	console.log('📊 STATISTIQUES DE LA BASE DE DONNÉES\n');

	console.log("1. Vérification de l'intégrité...");
	try {
		const integrity = db.prepare('PRAGMA integrity_check').all();
		if (integrity.length === 1 && integrity[0].integrity_check === 'ok') {
			console.log('   ✅ Intégrité OK');
		} else {
			console.error("   ❌ Problèmes d'intégrité détectés:");
			integrity.forEach((i) => console.error('      -', i.integrity_check));
			hasErrors = true;
			errors.push('integrity_check_failed');
		}
	} catch (e) {
		console.error('   ❌ Erreur lors de la vérification:', e.message);
		hasErrors = true;
		errors.push('integrity_check_error');
	}

	console.log('\n2. Tables présentes:');
	const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
	tables.forEach((t) => console.log(`   - ${t.name}`));

	const expectedTables = ['users', 'albums', 'album_user_permissions', 'album_tag_permissions'];
	const missingTables = expectedTables.filter((t) => !tables.find((row) => row.name === t));
	if (missingTables.length > 0) {
		console.error('   ❌ Tables manquantes:', missingTables.join(', '));
		hasErrors = true;
		errors.push('missing_tables');
	} else {
		console.log('   ✅ Toutes les tables attendues sont présentes');
	}

	console.log('\n3. Statistiques:');
	try {
		const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get();
		console.log(`   - Utilisateurs: ${userCount.c}`);

		const albumCount = db.prepare('SELECT COUNT(*) AS c FROM albums').get();
		console.log(`   - Albums: ${albumCount.c}`);

		const adminCount = db.prepare("SELECT COUNT(*) AS c FROM users WHERE role='admin'").get();
		console.log(`   - Administrateurs: ${adminCount.c}`);
	} catch (e) {
		console.error('   ❌ Erreur lors du comptage:', e.message);
		hasErrors = true;
		errors.push('count_error');
	}

	console.log('\n4. Vérification des clés étrangères...');
	try {
		const fkCheck = db.prepare('PRAGMA foreign_key_check').all();
		if (fkCheck.length === 0) {
			console.log('   ✅ Toutes les clés étrangères sont valides');
		} else {
			console.error('   ❌ Violations de clés étrangères détectées:');
			fkCheck.forEach((fk) => console.error('      -', JSON.stringify(fk)));
			hasErrors = true;
			errors.push('foreign_key_violations');
		}
	} catch (e) {
		console.error('   ❌ Erreur lors de la vérification des FK:', e.message);
		hasErrors = true;
		errors.push('fk_check_error');
	}

	console.log("\n5. Vérification de l'utilisateur système...");
	try {
		const systemAdmin = db.prepare('SELECT * FROM users WHERE id_user = ?').get(SYSTEM_USER_ID);
		if (systemAdmin) {
			console.log('   ✅ Utilisateur système présent:', systemAdmin.name || systemAdmin.id_user);
			if (systemAdmin.role !== 'admin') {
				console.warn("   ⚠️  Rôle incorrect pour l'utilisateur système (devrait être admin)");
				hasErrors = true;
				errors.push('system_user_wrong_role');
			}
		} else {
			console.error(`   ❌ Utilisateur système manquant (${SYSTEM_USER_ID})`);
			hasErrors = true;
			errors.push('system_user_missing');
		}
	} catch (e) {
		console.error('   ❌ Erreur lors de la vérification:', e.message);
		hasErrors = true;
		errors.push('system_user_check_error');
	}

	console.log('\n6. Exemples de données (premiers résultats):');
	try {
		console.log('\n   Utilisateurs (5 premiers):');
		const users = db.prepare('SELECT id_user, name, role, promo FROM users LIMIT 5').all();
		users.forEach((u) =>
			console.log(
				`      - ${u.id_user} (${u.name}) [${u.role}] ${u.promo ? `Promo ${u.promo}` : 'Système'}`
			)
		);

		console.log('\n   Albums (5 premiers):');
		const albums = db.prepare('SELECT id, name, visibility, visible FROM albums LIMIT 5').all();
		albums.forEach((a) =>
			console.log(`      - ${a.name} [${a.visibility}] ${a.visible ? '👁️' : '🔒'}`)
		);
	} catch (e) {
		console.warn('   ⚠️  Impossible de lire les exemples:', e.message);
	}
} catch (error) {
	console.error("\n❌ Erreur fatale lors de l'inspection:", error.message);
	hasErrors = true;
	errors.push('fatal_error');
} finally {
	try {
		db.close();
	} catch (e) {}
}

// Résumé et actions
console.log('\n' + '='.repeat(60));
if (!hasErrors) {
	console.log('✅ Base de données saine ! Aucune erreur détectée.');
	console.log('='.repeat(60));
	process.exit(0);
} else {
	console.log('❌ Erreurs détectées dans la base de données !');
	console.log('='.repeat(60));
	console.log('\nErreurs trouvées:');
	errors.forEach((e) => console.log(`   - ${e}`));

	if (REPAIR_MODE) {
		console.log('\n🔧 MODE RÉPARATION ACTIVÉ');
		console.log('\nTentative de réparation...');

		try {
			const dbWrite = new Database(DB_PATH);
			if (isBunRuntime()) {
				dbWrite.exec('PRAGMA foreign_keys = ON');
			} else {
				dbWrite.pragma('foreign_keys = ON');
			}

			let repaired = false;

			if (errors.includes('system_user_missing')) {
				console.log("   - Création de l'utilisateur système...");
				dbWrite
					.prepare(
						'INSERT OR IGNORE INTO users (id_user, name, first_name, last_name, photos_id, role, promo) VALUES (?, ?, ?, ?, ?, ?, ?)'
					)
					.run(SYSTEM_USER_ID, 'System Admin', 'System', 'Admin', null, 'admin', null);
				repaired = true;
			}

			if (errors.includes('system_user_wrong_role')) {
				console.log("   - Correction du rôle de l'utilisateur système...");
				dbWrite.prepare("UPDATE users SET role = 'admin' WHERE id_user = ?").run(SYSTEM_USER_ID);
				repaired = true;
			}

			dbWrite.close();

			if (repaired) {
				console.log('\n✅ Réparations appliquées !');
				console.log("💡 Relancez l'inspection pour vérifier.");
			} else {
				console.log('\n⚠️  Aucune réparation automatique disponible pour ces erreurs.');
				suggestBackupAndReset();
			}
		} catch (error) {
			console.error('\n❌ Erreur lors de la réparation:', error.message);
			suggestBackupAndReset();
		}
	} else {
		console.log('\n💡 Pour tenter une réparation automatique:');
		console.log('   npm run db:inspect -- --repair');
		console.log('\n💡 Si la réparation échoue, une sauvegarde et réinitialisation sera proposée.');
	}

	process.exit(1);
}

function suggestBackupAndReset() {
	console.log('\n⚠️  RÉPARATION AUTOMATIQUE IMPOSSIBLE');
	console.log('\n💡 Solutions recommandées:');
	console.log('   1. Sauvegarder la base actuelle:');
	console.log('      npm run db:backup');
	console.log('   2. Renommer ou supprimer la base corrompue');
	console.log('   3. Réinitialiser avec:');
	console.log('      npm run db:init');
	console.log('\n⚠️  Toutes les données seront perdues lors de la réinitialisation !');
}
