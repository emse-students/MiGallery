#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'migallery.db');

if (!fs.existsSync(DB_PATH)) {
	console.error('❌ Base de données non trouvée:', DB_PATH);
	process.exit(1);
}

// Utiliser bun:sqlite si disponible, sinon better-sqlite3
let db;
try {
	const { Database } = require('bun:sqlite');
	db = new Database(DB_PATH);
} catch {
	const Database = require('better-sqlite3');
	db = new Database(DB_PATH);
}

const sql = `
CREATE TABLE IF NOT EXISTS user_favorites (
    user_id TEXT NOT NULL,
    asset_id TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, asset_id),
    FOREIGN KEY(user_id) REFERENCES users(id_user) ON DELETE CASCADE
);
`;

try {
	db.exec(sql);
	console.log('✅ Table user_favorites créée avec succès!');
} catch (err) {
	console.error('❌ Erreur:', err.message);
	process.exit(1);
} finally {
	db.close();
}
