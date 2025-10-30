#!/usr/bin/env node
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'migallery.db');
console.log('Inspecting DB at', DB_PATH);
const db = new Database(DB_PATH, { readonly: true });
try {
  console.log('PRAGMA table_info(albums):');
  const cols = db.prepare("PRAGMA table_info('albums')").all();
  console.log(cols);

  console.log('\nSample rows (first 10):');
  try {
    const rows = db.prepare('SELECT id, immich_id, name, date, location, visibility, typeof(id) as type_id, typeof(immich_id) as type_imm FROM albums LIMIT 10').all();
    console.log(rows);
  } catch (e) {
    console.warn('Could not select sample rows:', e && e.message ? e.message : e);
  }

  console.log('\nCount rows in albums:');
  try { console.log(db.prepare('SELECT COUNT(*) AS c FROM albums').get()); } catch (e) { console.warn('count error', e.message); }
  console.log('\nForeign keys referencing albums:');
  try { console.log('album_user_permissions ->', db.prepare("PRAGMA foreign_key_list('album_user_permissions')").all()); } catch (e) { console.warn('fk album_user_permissions error', e.message); }
  try { console.log('album_tag_permissions ->', db.prepare("PRAGMA foreign_key_list('album_tag_permissions')").all()); } catch (e) { console.warn('fk album_tag_permissions error', e.message); }

  console.log('\nPRAGMA table_info for related tables:');
  try { console.log('album_user_permissions info:', db.prepare("PRAGMA table_info('album_user_permissions')").all()); } catch (e) { console.warn('table_info album_user_permissions error', e.message); }
  try { console.log('album_tag_permissions info:', db.prepare("PRAGMA table_info('album_tag_permissions')").all()); } catch (e) { console.warn('table_info album_tag_permissions error', e.message); }
} finally {
  try { db.close(); } catch (e) {}
}

console.log('\nDone.');
