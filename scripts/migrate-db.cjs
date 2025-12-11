#!/usr/bin/env node
/**
 * Script de migration de base de données
 * Crée ou met à jour les tables manquantes sans supprimer les données existantes
 */

const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'migallery.db');

if (!fs.existsSync(DB_PATH)) {
	console.error('❌ Base de données non trouvée:', DB_PATH);
	process.exit(1);
}

let Database;
try {
	// Essayer d'utiliser bun:sqlite si disponible
	Database = require('bun:sqlite').Database;
} catch {
	// Sinon utiliser better-sqlite3
	Database = require('better-sqlite3');
}

const db = new Database(DB_PATH);

// Liste des migrations à appliquer
const migrations = [
	{
		name: 'Create users table',
		sql: `CREATE TABLE IF NOT EXISTS users (
      id_user TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      prenom TEXT NOT NULL,
      nom TEXT NOT NULL,
      id_photos TEXT,
      first_login INTEGER DEFAULT 1,
      role TEXT DEFAULT 'user',
      promo_year INTEGER
    )`
	},
	{
		name: 'Create albums table',
		sql: `CREATE TABLE IF NOT EXISTS albums (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      date TEXT,
      location TEXT,
      visibility TEXT NOT NULL DEFAULT 'authenticated',
      visible INTEGER NOT NULL DEFAULT 1
    )`
	},
	{
		name: 'Create album_user_permissions table',
		sql: `CREATE TABLE IF NOT EXISTS album_user_permissions (
      album_id TEXT NOT NULL,
      id_user TEXT NOT NULL,
      PRIMARY KEY (album_id, id_user),
      FOREIGN KEY(album_id) REFERENCES albums(id) ON DELETE CASCADE
    )`
	},
	{
		name: 'Create album_tag_permissions table',
		sql: `CREATE TABLE IF NOT EXISTS album_tag_permissions (
      album_id TEXT NOT NULL,
      tag TEXT NOT NULL,
      PRIMARY KEY (album_id, tag),
      FOREIGN KEY(album_id) REFERENCES albums(id) ON DELETE CASCADE
    )`
	},
	{
		name: 'Create user_favorites table',
		sql: `CREATE TABLE IF NOT EXISTS user_favorites (
      user_id TEXT NOT NULL,
      asset_id TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, asset_id),
      FOREIGN KEY(user_id) REFERENCES users(id_user) ON DELETE CASCADE
    )`
	},
	{
		name: 'Create photo_access_permissions table',
		sql: `CREATE TABLE IF NOT EXISTS photo_access_permissions (
      owner_id TEXT NOT NULL,
      authorized_id TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (owner_id, authorized_id),
      FOREIGN KEY(owner_id) REFERENCES users(id_user) ON DELETE CASCADE,
      FOREIGN KEY(authorized_id) REFERENCES users(id_user) ON DELETE CASCADE
    )`
	}
];

let successCount = 0;
let skipCount = 0;

console.log('🚀 Début de la migration de la base de données...\n');

try {
	for (const migration of migrations) {
		try {
			// Vérifier si la table existe déjà
			const tableName = extractTableName(migration.sql);
			const tableExists = checkTableExists(db, tableName);

			if (tableExists) {
				console.log(`⏭️  ${migration.name} - Table existe déjà`);
				skipCount++;
			} else {
				db.exec(migration.sql);
				console.log(`✅ ${migration.name}`);
				successCount++;
			}
		} catch (err) {
			console.error(`❌ ${migration.name} - ${err.message}`);
			process.exit(1);
		}
	}

	console.log(`\n📊 Résumé:`);
	console.log(`   ✅ Tables créées: ${successCount}`);
	console.log(`   ⏭️  Tables existantes: ${skipCount}`);

	// Afficher l'état des tables
	console.log(`\n📋 État des tables:`);
	const tables = getTables(db);
	for (const table of tables) {
		const count = getTableRowCount(db, table);
		console.log(`   • ${table}: ${count} ligne(s)`);
	}

	console.log('\n✨ Migration terminée avec succès!');
	process.exit(0);
} catch (err) {
	console.error('❌ Erreur durant la migration:', err.message);
	process.exit(1);
} finally {
	db.close();
}

// Utilitaires
function extractTableName(sql) {
	const match = sql.match(/CREATE TABLE IF NOT EXISTS\s+(\w+)/i);
	return match ? match[1] : null;
}

function checkTableExists(db, tableName) {
	try {
		const result = db
			.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`)
			.get(tableName);
		return !!result;
	} catch {
		return false;
	}
}

function getTables(db) {
	try {
		const result = db
			.prepare(
				`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
			)
			.all();
		return result.map((r) => r.name);
	} catch {
		return [];
	}
}

function getTableRowCount(db, tableName) {
	try {
		const result = db.prepare(`SELECT COUNT(*) as count FROM ${tableName}`).get();
		return result.count;
	} catch {
		return 0;
	}
}
