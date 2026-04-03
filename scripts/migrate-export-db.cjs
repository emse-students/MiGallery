#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

let Database;
try {
	Database = require('bun:sqlite').Database;
} catch {
	Database = require('better-sqlite3');
}

const sourcePath = process.argv[2];
const targetPath = process.argv[3] || path.join(process.cwd(), 'data', 'migallery.db');

if (!sourcePath) {
	console.error('Usage: node scripts/migrate-export-db.cjs <source.db> [target.db]');
	process.exit(1);
}

const resolvedSourcePath = path.resolve(sourcePath);
const resolvedTargetPath = path.resolve(targetPath);
const targetDir = path.dirname(resolvedTargetPath);
const backupPath = `${resolvedTargetPath}.before-migrate-${Date.now()}`;

if (!fs.existsSync(resolvedSourcePath)) {
	console.error('❌ Source DB not found:', resolvedSourcePath);
	process.exit(1);
}

if (!fs.existsSync(targetDir)) {
	fs.mkdirSync(targetDir, { recursive: true });
}

if (fs.existsSync(resolvedTargetPath)) {
	fs.copyFileSync(resolvedTargetPath, backupPath);
	console.log('💾 Existing target backup created:', backupPath);
	fs.unlinkSync(resolvedTargetPath);
}

const sourceDb = new Database(resolvedSourcePath, { readonly: true });
const targetDb = new Database(resolvedTargetPath);

function readSchema() {
	const schemaPath = path.join(process.cwd(), 'src', 'lib', 'db', 'schema.sql');
	return fs.readFileSync(schemaPath, 'utf8');
}

function getTableNames(db) {
	return db
		.prepare(
			"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
		)
		.all()
		.map((row) => row.name);
}

function countRows(db, tableName) {
	return db.prepare(`SELECT COUNT(*) AS c FROM ${tableName}`).get().c;
}

function insertAlbums() {
	const rows = sourceDb
		.prepare('SELECT id, name, date, location, visibility, visible FROM albums ORDER BY id')
		.all();
	const stmt = targetDb.prepare(
		'INSERT OR REPLACE INTO albums (id, name, date, location, visibility, visible) VALUES (?, ?, ?, ?, ?, ?)'
	);
	for (const row of rows) {
		stmt.run(
			row.id,
			row.name,
			row.date ?? null,
			row.location ?? null,
			row.visibility || 'authenticated',
			typeof row.visible === 'number' ? row.visible : 1
		);
	}
	return rows.length;
}

function insertAlbumTagsAndDerivedPermissions() {
	const rows = sourceDb
		.prepare('SELECT album_id, tag FROM album_tag_permissions ORDER BY album_id, tag')
		.all();
	const tagStmt = targetDb.prepare(
		'INSERT OR IGNORE INTO album_tag_permissions (album_id, tag) VALUES (?, ?)'
	);
	const promoStmt = targetDb.prepare(
		'INSERT OR IGNORE INTO album_promo_permissions (album_id, promo_year) VALUES (?, ?)'
	);

	let derivedPromoCount = 0;
	for (const row of rows) {
		tagStmt.run(row.album_id, row.tag);
		const match = /^promo\s+(\d{4})$/i.exec(String(row.tag || '').trim());
		if (match) {
			promoStmt.run(row.album_id, Number.parseInt(match[1], 10));
			derivedPromoCount += 1;
		}
	}

	return {
		tagCount: rows.length,
		derivedPromoCount
	};
}

function insertApiKeys() {
	const sourceTables = new Set(getTableNames(sourceDb));
	if (!sourceTables.has('api_keys')) {
		return 0;
	}

	const rows = sourceDb
		.prepare('SELECT key_hash, label, scopes, revoked, created_at FROM api_keys ORDER BY id')
		.all();
	const stmt = targetDb.prepare(
		'INSERT OR IGNORE INTO api_keys (key_hash, label, scopes, revoked, created_at) VALUES (?, ?, ?, ?, ?)'
	);
	for (const row of rows) {
		stmt.run(row.key_hash, row.label ?? null, row.scopes ?? null, row.revoked ?? 0, row.created_at);
	}
	return rows.length;
}

function insertLogs() {
	const sourceTables = new Set(getTableNames(sourceDb));
	if (!sourceTables.has('logs')) {
		return 0;
	}

	const rows = sourceDb
		.prepare(
			'SELECT timestamp, actor, event_type, target_type, target_id, details, ip FROM logs ORDER BY id'
		)
		.all();
	const stmt = targetDb.prepare(
		'INSERT INTO logs (timestamp, actor, event_type, target_type, target_id, details, ip) VALUES (?, ?, ?, ?, ?, ?, ?)'
	);
	for (const row of rows) {
		stmt.run(
			row.timestamp ?? null,
			row.actor ?? null,
			row.event_type ?? null,
			row.target_type ?? null,
			row.target_id ?? null,
			row.details ?? null,
			row.ip ?? null
		);
	}
	return rows.length;
}

try {
	targetDb.exec('PRAGMA foreign_keys = OFF');
	targetDb.exec(readSchema());
	targetDb.exec('BEGIN TRANSACTION');

	const migratedAlbums = insertAlbums();
	const permissions = insertAlbumTagsAndDerivedPermissions();
	const migratedApiKeys = insertApiKeys();
	const migratedLogs = insertLogs();

	targetDb.exec('COMMIT');
	targetDb.exec('PRAGMA foreign_keys = ON');

	console.log('✅ Migration complete');
	console.log('   Source:', resolvedSourcePath);
	console.log('   Target:', resolvedTargetPath);
	console.log('');
	console.log('   Migrated albums               :', migratedAlbums);
	console.log('   Migrated album tag perms      :', permissions.tagCount);
	console.log('   Derived promo perms from tags :', permissions.derivedPromoCount);
	console.log('   Migrated api keys             :', migratedApiKeys);
	console.log('   Migrated logs                 :', migratedLogs);
	console.log('');
	console.log('   Skipped users                 :', countRows(sourceDb, 'users'));
	console.log(
		'   Skipped album user perms      :',
		new Set(getTableNames(sourceDb)).has('album_user_permissions')
			? countRows(sourceDb, 'album_user_permissions')
			: 0
	);
	console.log(
		'   Skipped user favorites        :',
		new Set(getTableNames(sourceDb)).has('user_favorites') ? countRows(sourceDb, 'user_favorites') : 0
	);
	console.log(
		'   Skipped photo access perms    :',
		new Set(getTableNames(sourceDb)).has('photo_access_permissions')
			? countRows(sourceDb, 'photo_access_permissions')
			: 0
	);
} catch (error) {
	try {
		targetDb.exec('ROLLBACK');
	} catch {
		void 0;
	}
	console.error('❌ Migration failed:', error.message);
	process.exitCode = 1;
} finally {
	try {
		sourceDb.close();
	} catch {
		void 0;
	}
	try {
		targetDb.close();
	} catch {
		void 0;
	}
}
