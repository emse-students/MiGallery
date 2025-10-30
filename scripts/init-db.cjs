#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

console.log('🚀 Initialisation de la base de données (fresh create)...');

const DB_PATH = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'migallery.db');
const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

// Remove existing DB to start fresh
try {
  if (fs.existsSync(DB_PATH)) {
    fs.unlinkSync(DB_PATH);
    console.log('Existing DB removed:', DB_PATH);
  }
} catch (e) {
  console.warn('Could not remove existing DB:', e && e.message ? e.message : e);
}

const db = new Database(DB_PATH);

try {
  db.pragma('foreign_keys = ON');

  const schemaPath = path.join(process.cwd(), 'src', 'lib', 'db', 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  db.exec(schema);

  // Insert demo user if not present
  db.prepare("INSERT OR IGNORE INTO users (id_user, email, prenom, nom, id_photos, first_login, role) VALUES (?, ?, ?, ?, ?, ?, ?)").run('jolan.boudin', 'jolan.boudin@etu.emse.fr', 'Jolan', 'BOUDIN', '031b39ea-7c35-4d52-bc00-46ff0d927afa', 0, 'user');

  // If IMMICH configured, import albums (id = immich id)
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

  const insert = db.prepare('INSERT OR IGNORE INTO albums (id, name, date, location, visibility, visible) VALUES (?, ?, ?, ?, ?, ?)');
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
        console.warn('Error fetching/importing albums from Immich:', err && err.message ? err.message : err);
      }
    })();
  } else {
    console.log('IMMICH_BASE_URL not set; skipping albums import.');
  }

  console.log('✅ DB initialization complete.');
} finally {
  try { db.close(); } catch (e) {}
}
