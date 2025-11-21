import { getDatabase } from './database';
import crypto from 'crypto';

function hashKey(raw: string) {
	return crypto.createHash('sha256').update(raw).digest('hex');
}

export function generateRawKey() {
	return crypto
		.randomBytes(32)
		.toString('base64')
		.replace(/=/g, '')
		.replace(/\+/g, '-')
		.replace(/\//g, '_');
}

export function createApiKey(label?: string, scopes?: string[]) {
	const db = getDatabase();
	const raw = generateRawKey();
	const keyHash = hashKey(raw);
	const now = Date.now();
	const stmt = db.prepare(
		'INSERT INTO api_keys (key_hash, label, scopes, revoked, created_at) VALUES (?, ?, ?, 0, ?)'
	);
	const info = stmt.run(keyHash, label || null, scopes ? scopes.join(',') : null, now);
	return { id: Number(info.lastInsertRowid), rawKey: raw };
}

export function listApiKeys(): Array<{
	id: number;
	label: string | null;
	scopes: string | null;
	revoked: number;
	created_at: number;
}> {
	const db = getDatabase();
	const rows = db
		.prepare('SELECT id, label, scopes, revoked, created_at FROM api_keys ORDER BY created_at DESC')
		.all() as Array<{
		id: number;
		label: string | null;
		scopes: string | null;
		revoked: number;
		created_at: number;
	}>;
	return rows;
}

export function revokeApiKey(id: number) {
	const db = getDatabase();
	const info = db.prepare('UPDATE api_keys SET revoked = 1 WHERE id = ?').run(id);
	return info.changes;
}

export function verifyRawKeyWithScope(raw?: string, requiredScope?: string): boolean {
	if (!raw) {
		return false;
	}
	const db = getDatabase();
	const keyHash = hashKey(raw);
	const row = db
		.prepare('SELECT id, scopes FROM api_keys WHERE key_hash = ? AND revoked = 0 LIMIT 1')
		.get(keyHash) as { id: number; scopes: string | null } | undefined;
	if (!row) {
		return false;
	}
	if (!requiredScope) {
		return true;
	}
	const scopes = (row.scopes || '')
		.split(',')
		.map((s: string) => s.trim())
		.filter(Boolean);
	// Treat 'admin' as a superset scope: admin can perform any scoped action
	if (scopes.includes('admin')) {
		return true;
	}
	if (!requiredScope) {
		return true;
	}
	return scopes.includes(requiredScope);
}
