#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Detect runtime and load appropriate database driver
function isBunRuntime() {
	return typeof Bun !== 'undefined';
}

let Database;
if (isBunRuntime()) {
	Database = require('bun:sqlite').Database;
} else {
	Database = require('better-sqlite3');
}

function generateRawKey() {
	return crypto
		.randomBytes(32)
		.toString('base64')
		.replace(/=/g, '')
		.replace(/\+/g, '-')
		.replace(/\//g, '_');
}

function hashKey(raw) {
	return crypto.createHash('sha256').update(raw).digest('hex');
}

const DB_PATH = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'migallery.db');
const label = process.argv[2] || 'generated-by-script';
const scopesArg = process.argv[3] || null; // comma separated
const scopes = scopesArg
	? scopesArg
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean)
			.join(',')
	: null;

try {
	const dir = path.dirname(DB_PATH);
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

	const db = new Database(DB_PATH);

	// ensure table exists (mimic migration behavior)
	db.exec(`CREATE TABLE IF NOT EXISTS api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key_hash TEXT NOT NULL UNIQUE,
    label TEXT,
    scopes TEXT,
    revoked INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`);

	const raw = generateRawKey();
	const keyHash = hashKey(raw);
	const now = Date.now();

	const stmt = db.prepare(
		'INSERT INTO api_keys (key_hash, label, scopes, revoked, created_at) VALUES (?, ?, ?, 0, ?)'
	);
	const info = stmt.run(keyHash, label || null, scopes, now);

	console.log('API key created:');
	console.log(raw);
	console.log('\n---- Store this key securely. This raw key will NOT be shown again. ----');
	process.exit(0);
} catch (err) {
	console.error('Failed to create API key:', err);
	process.exit(2);
}
