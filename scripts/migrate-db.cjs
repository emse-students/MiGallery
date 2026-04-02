#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'migallery.db');

if (!fs.existsSync(DB_PATH)) {
	console.error('❌ Base de données non trouvée:', DB_PATH);
	process.exit(1);
}

let Database;
try {
	Database = require('bun:sqlite').Database;
} catch {
	// Sinon utiliser better-sqlite3
	Database = require('better-sqlite3');
}

const db = new Database(DB_PATH);

const migrations = [
	{
		name: 'Create users table',
		sql: `CREATE TABLE IF NOT EXISTS users (
      id_user TEXT PRIMARY KEY,
      nom TEXT NOT NULL,
      id_photos TEXT,
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
	},
	{
		name: 'Create api_keys table',
		sql: `CREATE TABLE IF NOT EXISTS api_keys (
      id INTEGER PRIMARY KEY,
      key_hash TEXT NOT NULL UNIQUE,
      label TEXT,
      scopes TEXT,
      revoked INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    )`
	}
];

let successCount = 0;
let skipCount = 0;

console.log('🚀 Début de la migration de la base de données...\n');

try {
	// --- MIGRATIONS MANUELLES DE COLONNES (POUR UPDATES) ---
	// --------------------------------------------------------

	try {
		const columns = db.prepare('PRAGMA table_info(users)').all();
		const hasLegacyCols = columns.some((c) => ['email', 'prenom', 'first_login'].includes(c.name));
		if (hasLegacyCols) {
			console.log('🔄 Migration users legacy -> compact schema...');
			db.exec('BEGIN TRANSACTION');
			db.exec(`
				CREATE TABLE IF NOT EXISTS users_new (
					id_user TEXT PRIMARY KEY,
					nom TEXT NOT NULL,
					id_photos TEXT,
					role TEXT DEFAULT 'user',
					promo_year INTEGER
				)
			`);
			db.exec(`
				INSERT INTO users_new (id_user, nom, id_photos, role, promo_year)
				SELECT
					id_user,
					CASE
						WHEN TRIM(COALESCE(prenom, '') || ' ' || COALESCE(nom, '')) <> '' THEN TRIM(COALESCE(prenom, '') || ' ' || COALESCE(nom, ''))
						WHEN COALESCE(nom, '') <> '' THEN nom
						ELSE id_user
					END,
					id_photos,
					COALESCE(role, 'user'),
					promo_year
				FROM users
			`);
			db.exec('DROP TABLE users');
			db.exec('ALTER TABLE users_new RENAME TO users');
			db.exec('COMMIT');
			console.log('✅ Migration users terminée');
		}
	} catch (e) {
		db.exec('ROLLBACK');
		console.error('❌ Migration users échouée:', e.message);
		process.exit(1);
	}

	// Renommer l'ancien utilisateur système les.roots vers le nouveau hash ID Authentik
	try {
		const SYSTEM_USER_ID = 'dd68bb5b4f7c56878a1bd873593a3e7c3434242c80871e4ead9fe99d3f48a782';
		const oldUser = db.prepare("SELECT id_user FROM users WHERE id_user = 'les.roots'").get();
		if (oldUser) {
			const newExists = db.prepare('SELECT id_user FROM users WHERE id_user = ?').get(SYSTEM_USER_ID);
			if (newExists) {
				// Le nouveau hash existe déjà, on supprime juste l'ancien
				db.prepare("DELETE FROM users WHERE id_user = 'les.roots'").run();
				console.log('🔄 Ancien utilisateur les.roots supprimé (le nouveau hash existait déjà)');
			} else {
				db.prepare("UPDATE users SET id_user = ? WHERE id_user = 'les.roots'").run(SYSTEM_USER_ID);
				console.log('✅ Migration id système: les.roots → hash Authentik');
			}
		}
	} catch (e) {
		console.error('⚠️  Migration id système échouée:', e.message);
	}

	for (const migration of migrations) {
		try {
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
