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

console.log('🚀 Initialisation de la base de données...');
console.log(`   Runtime: ${isBunRuntime() ? 'Bun (bun:sqlite)' : 'Node.js (better-sqlite3)'}`);

const DB_PATH = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'migallery.db');
const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const dbExists = fs.existsSync(DB_PATH);
if (dbExists) {
	console.log('⚠️  Base de données déjà existante:', DB_PATH);
	console.log("Script d'initialisation annulé (la DB existe déjà).");
	console.log("Pour réinitialiser, supprimez d'abord le fichier DB.");
	process.exit(0);
}

const db = new Database(DB_PATH);

try {
	if (isBunRuntime()) {
		db.exec('PRAGMA foreign_keys = ON');
	} else {
		db.pragma('foreign_keys = ON');
	}

	const schemaPath = path.join(process.cwd(), 'src', 'lib', 'db', 'schema.sql');
	const schema = fs.readFileSync(schemaPath, 'utf8');
	db.exec(schema);

	db
		.prepare(
			'INSERT OR IGNORE INTO users (id_user, nom, id_photos, role, promo_year) VALUES (?, ?, ?, ?, ?)'
		)
		.run(
			'dd68bb5b4f7c56878a1bd873593a3e7c3434242c80871e4ead9fe99d3f48a782',
			'System Admin',
			null,
			'admin',
			null
		);
	console.log(
		'✅ Utilisateur système admin créé: dd68bb5b4f7c56878a1bd873593a3e7c3434242c80871e4ead9fe99d3f48a782'
	);

	const base = process.env.IMMICH_BASE_URL;
	const apiKey = process.env.IMMICH_API_KEY;
	if (base) {
		(async () => {
			try {
				const url = base.replace(/\/$/, '') + '/api/albums';
				console.log('Fetching albums from Immich:', url);
				const res = await fetch(url, { headers: { 'x-api-key': apiKey || '' } });
				if (!res.ok) {
					console.warn('Immich fetch failed:', res.status, res.statusText);
					return;
				}
				const list = await res.json();
				if (!Array.isArray(list)) {
					console.warn('Unexpected albums response:', typeof list, list && list.length);
					return;
				}

				const insert = db.prepare(
					'INSERT OR IGNORE INTO albums (id, name, date, location, visibility, visible) VALUES (?, ?, ?, ?, ?, ?)'
				);
				let added = 0;
				for (const a of list) {
					const immichId = a.id || a.albumId || a.album_id || a._id || null;
					if (!immichId) continue;
					let name = a.name || a.title || a.albumName || String(immichId || '');
					// detect leading date in YYYY-MM-DD pattern
					let dateVal = null;
					const m = name.match(/^([0-9]{4}-[0-9]{2}-[0-9]{2})\s*(.*)$/);
					if (m) {
						dateVal = m[1];
						name = m[2] || name;
					}
					insert.run(immichId, name, dateVal, null, 'private', 1);
					added++;
				}
				console.log(`Imported ${added} albums from Immich (visibility=private)`);
			} catch (err) {
				console.warn(
					'Error fetching/importing albums from Immich:',
					err && err.message ? err.message : err
				);
			}
		})();
	} else {
		console.log('IMMICH_BASE_URL not set; skipping albums import.');
	}

	console.log('✅ DB initialization complete.');
} finally {
	try {
		db.close();
	} catch (e) {}
}
