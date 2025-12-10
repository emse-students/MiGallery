#!/usr/bin/env node
/**
 * Script de nettoyage des artefacts de test
 * Supprime les utilisateurs, albums, et clés API créés pendant les tests
 *
 * Convention de nommage pour les tests:
 * - Utilisateurs: commencent par "test." (ex: test.user.123456789)
 * - Albums: commencent par "[TEST]" (ex: [TEST] Permission Album 123456789)
 * - Clés API: commencent par "[TEST]" (ex: [TEST] Admin Key)
 */

const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'migallery.db');

async function main() {
	console.log('\n🧹 Nettoyage des artefacts de test\n');
	console.log(`📁 Base de données: ${DB_PATH}\n`);

	if (!fs.existsSync(DB_PATH)) {
		console.log('❌ Base de données introuvable');
		return;
	}

	// Détecter si on est dans Bun ou Node
	const isBun = typeof globalThis.Bun !== 'undefined';
	let Database;

	if (isBun) {
		const { Database: BunDatabase } = require('bun:sqlite');
		Database = BunDatabase;
	} else {
		Database = require('better-sqlite3');
	}

	const db = new Database(DB_PATH);

	try {
		// 1. Supprimer les utilisateurs de test (ceux qui commencent par 'test.')
		const testUsers = db.prepare("SELECT id_user FROM users WHERE id_user LIKE 'test.%'").all();

		if (testUsers.length > 0) {
			console.log(`👤 ${testUsers.length} utilisateur(s) de test trouvé(s):`);
			testUsers.forEach((u) => console.log(`   - ${u.id_user}`));

			const deleteUsers = db.prepare("DELETE FROM users WHERE id_user LIKE 'test.%'");
			const result = deleteUsers.run();
			console.log(`   ✅ ${result.changes} utilisateur(s) supprimé(s)\n`);
		} else {
			console.log('👤 Aucun utilisateur de test trouvé\n');
		}

		// 2. Supprimer les clés API de test (commencent par '[TEST]' ou sont NULL)
		const testApiKeys = db
			.prepare(
				`SELECT id, label FROM api_keys WHERE
				label LIKE '[TEST]%'
				OR label IS NULL`
			)
			.all();

		if (testApiKeys.length > 0) {
			console.log(`🔑 ${testApiKeys.length} clé(s) API de test trouvée(s):`);
			testApiKeys.forEach((k) => console.log(`   - ${k.id}: ${k.label || '(null)'}`));

			const deleteApiKeys = db.prepare(`DELETE FROM api_keys WHERE
				label LIKE '[TEST]%'
				OR label IS NULL`);
			const result = deleteApiKeys.run();
			console.log(`   ✅ ${result.changes} clé(s) API supprimée(s)\n`);
		} else {
			console.log('🔑 Aucune clé API de test trouvée\n');
		}

		// 3. Supprimer les albums de test (commencent par '[TEST]')
		const testAlbums = db.prepare("SELECT id, name FROM albums WHERE name LIKE '[TEST]%'").all();

		if (testAlbums.length > 0) {
			console.log(`📁 ${testAlbums.length} album(s) de test trouvé(s):`);
			testAlbums.forEach((a) => console.log(`   - ${a.id}: ${a.name}`));

			const deleteAlbums = db.prepare("DELETE FROM albums WHERE name LIKE '[TEST]%'");
			const result = deleteAlbums.run();
			console.log(`   ✅ ${result.changes} album(s) supprimé(s)\n`);
		} else {
			console.log('📁 Aucun album de test trouvé\n');
		}

		// 4. Vérifier les permissions orphelines
		const orphanedTagPerms = db
			.prepare(
				`
				SELECT COUNT(*) as count FROM album_tag_permissions
				WHERE album_id NOT IN (SELECT id FROM albums)
			`
			)
			.get();

		if (orphanedTagPerms.count > 0) {
			console.log(`🏷️  ${orphanedTagPerms.count} permission(s) de tag orpheline(s) trouvée(s)`);
			db
				.prepare('DELETE FROM album_tag_permissions WHERE album_id NOT IN (SELECT id FROM albums)')
				.run();
			console.log('   ✅ Supprimées\n');
		}

		const orphanedUserPerms = db
			.prepare(
				`
				SELECT COUNT(*) as count FROM album_user_permissions
				WHERE album_id NOT IN (SELECT id FROM albums)
			`
			)
			.get();

		if (orphanedUserPerms.count > 0) {
			console.log(`👥 ${orphanedUserPerms.count} permission(s) utilisateur orpheline(s) trouvée(s)`);
			db
				.prepare('DELETE FROM album_user_permissions WHERE album_id NOT IN (SELECT id FROM albums)')
				.run();
			console.log('   ✅ Supprimées\n');
		}

		// 5. Afficher un résumé
		console.log('📊 État actuel de la base de données:');
		const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
		const apiKeyCount = db.prepare('SELECT COUNT(*) as count FROM api_keys').get();
		const albumCount = db.prepare('SELECT COUNT(*) as count FROM albums').get();
		console.log(`   - Utilisateurs: ${userCount.count}`);
		console.log(`   - Clés API: ${apiKeyCount.count}`);
		console.log(`   - Albums: ${albumCount.count}`);

		console.log('\n✅ Nettoyage terminé\n');
	} finally {
		db.close();
	}
}

main().catch(console.error);
