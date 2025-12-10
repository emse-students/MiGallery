#!/usr/bin/env node
/**
 * Script de nettoyage des albums de test sur Immich
 * Supprime les albums dont le nom contient 'Test', 'test', 'Permission', etc.
 *
 * Usage: node scripts/cleanup-immich-test-albums.cjs [--dry-run]
 */

const path = require('path');
const fs = require('fs');

// Charger les variables d'environnement depuis .env
const envPath = path.join(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
	const envContent = fs.readFileSync(envPath, 'utf-8');
	envContent.split('\n').forEach((line) => {
		const [key, ...valueParts] = line.split('=');
		if (key && valueParts.length > 0) {
			const value = valueParts
				.join('=')
				.trim()
				.replace(/^["']|["']$/g, '');
			if (!process.env[key.trim()]) {
				process.env[key.trim()] = value;
			}
		}
	});
}

const IMMICH_BASE_URL = process.env.IMMICH_BASE_URL;
const IMMICH_API_KEY = process.env.IMMICH_API_KEY;
const DB_PATH = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'migallery.db');

const DRY_RUN = process.argv.includes('--dry-run');

// Patterns d'albums de test à supprimer
const TEST_PATTERNS = [
	/^Test\s/i,
	/Test$/i,
	/\bTest\b/i,
	/^Permission\s/i,
	/Permission\sTest/i,
	/^Delete\sTest/i,
	/^E2E\s/i,
	/^API\sTest/i,
	/^Integration\sTest/i,
	/Created via test/i
];

function isTestAlbum(albumName) {
	return TEST_PATTERNS.some((pattern) => pattern.test(albumName));
}

async function main() {
	console.log('\n🧹 Nettoyage des albums de test sur Immich\n');

	if (DRY_RUN) {
		console.log('⚠️  MODE DRY-RUN: Aucune suppression ne sera effectuée\n');
	}

	if (!IMMICH_BASE_URL || !IMMICH_API_KEY) {
		console.error('❌ IMMICH_BASE_URL et IMMICH_API_KEY doivent être définis dans .env');
		process.exit(1);
	}

	console.log(`📡 Serveur Immich: ${IMMICH_BASE_URL}`);
	console.log(`📁 Base de données locale: ${DB_PATH}\n`);

	// 1. Récupérer tous les albums d'Immich
	console.log('📥 Récupération des albums depuis Immich...');

	let allAlbums;
	try {
		const response = await fetch(`${IMMICH_BASE_URL}/api/albums`, {
			headers: {
				'x-api-key': IMMICH_API_KEY,
				Accept: 'application/json'
			}
		});

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${await response.text()}`);
		}

		allAlbums = await response.json();
		console.log(`   ✅ ${allAlbums.length} albums trouvés\n`);
	} catch (err) {
		console.error('❌ Erreur lors de la récupération des albums:', err.message);
		process.exit(1);
	}

	// 2. Identifier les albums de test
	const testAlbums = allAlbums.filter((album) => isTestAlbum(album.albumName));

	if (testAlbums.length === 0) {
		console.log('✅ Aucun album de test trouvé sur Immich\n');
	} else {
		console.log(`🗑️  ${testAlbums.length} album(s) de test identifié(s):`);
		testAlbums.forEach((album) => {
			console.log(`   - ${album.albumName} (${album.id}) - ${album.assetCount || 0} assets`);
		});
		console.log('');

		// 3. Supprimer les albums de test
		if (!DRY_RUN) {
			let deleted = 0;
			let failed = 0;

			for (const album of testAlbums) {
				try {
					const response = await fetch(`${IMMICH_BASE_URL}/api/albums/${album.id}`, {
						method: 'DELETE',
						headers: {
							'x-api-key': IMMICH_API_KEY
						}
					});

					if (response.ok) {
						console.log(`   ✅ Supprimé: ${album.albumName}`);
						deleted++;
					} else {
						const errorText = await response.text();
						console.log(`   ❌ Échec: ${album.albumName} - ${errorText}`);
						failed++;
					}
				} catch (err) {
					console.log(`   ❌ Erreur: ${album.albumName} - ${err.message}`);
					failed++;
				}
			}

			console.log(`\n📊 Résultat: ${deleted} supprimé(s), ${failed} échec(s)\n`);
		}
	}

	// 4. Nettoyer aussi la BDD locale
	if (fs.existsSync(DB_PATH)) {
		console.log('🗄️  Nettoyage de la base de données locale...');

		// Détecter si on est dans Bun ou Node
		const isBun = typeof globalThis.Bun !== 'undefined';
		let Database;

		if (isBun) {
			const { Database: BunDatabase } = require('bun:sqlite');
			Database = BunDatabase;
		} else {
			try {
				Database = require('better-sqlite3');
			} catch {
				console.log('   ⚠️  better-sqlite3 non disponible, nettoyage BDD ignoré');
				return;
			}
		}

		const db = new Database(DB_PATH);

		try {
			// Compter les albums de test
			const testAlbumsInDb = db
				.prepare(
					`
				SELECT id, name FROM albums
				WHERE name LIKE '%Test%'
				   OR name LIKE '%test%'
				   OR name LIKE '%Permission%'
				   OR name LIKE '%E2E%'
			`
				)
				.all();

			if (testAlbumsInDb.length > 0) {
				console.log(`   📋 ${testAlbumsInDb.length} album(s) de test dans la BDD locale:`);
				testAlbumsInDb.forEach((a) => console.log(`      - ${a.name} (${a.id})`));

				if (!DRY_RUN) {
					// Supprimer les permissions associées
					db
						.prepare(
							`
						DELETE FROM album_tag_permissions
						WHERE album_id IN (
							SELECT id FROM albums
							WHERE name LIKE '%Test%'
							   OR name LIKE '%test%'
							   OR name LIKE '%Permission%'
							   OR name LIKE '%E2E%'
						)
					`
						)
						.run();

					db
						.prepare(
							`
						DELETE FROM album_user_permissions
						WHERE album_id IN (
							SELECT id FROM albums
							WHERE name LIKE '%Test%'
							   OR name LIKE '%test%'
							   OR name LIKE '%Permission%'
							   OR name LIKE '%E2E%'
						)
					`
						)
						.run();

					// Supprimer les albums
					const result = db
						.prepare(
							`
						DELETE FROM albums
						WHERE name LIKE '%Test%'
						   OR name LIKE '%test%'
						   OR name LIKE '%Permission%'
						   OR name LIKE '%E2E%'
					`
						)
						.run();

					console.log(`   ✅ ${result.changes} album(s) supprimé(s) de la BDD locale\n`);
				}
			} else {
				console.log('   ✅ Aucun album de test dans la BDD locale\n');
			}
		} finally {
			db.close();
		}
	}

	console.log('✨ Nettoyage terminé!\n');
}

main().catch((err) => {
	console.error('❌ Erreur fatale:', err);
	process.exit(1);
});
