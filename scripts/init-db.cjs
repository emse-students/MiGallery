#!/usr/bin/env bun
const fs = require('fs');
const path = require('path');

const { Database } = require('bun:sqlite');

console.log('🚀 Initialisation de la base de données...');

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

async function importAlbumsFromImmich(base, apiKey) {
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
}

async function main() {
  try {
    db.exec('PRAGMA foreign_keys = ON');

    const schemaPath = path.join(process.cwd(), 'src', 'lib', 'db', 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    db.exec(schema);

    // No account is created here: the first admin signs in once through MiConnect, then is
    // promoted by hand (README, "First administrator").
    console.log('ℹ️  Aucun compte créé : voir README, section "First administrator".');

    const base = process.env.IMMICH_BASE_URL;
    const apiKey = process.env.IMMICH_API_KEY;
    if (base) {
      await importAlbumsFromImmich(base, apiKey);
    } else {
      console.log('IMMICH_BASE_URL not set; skipping albums import.');
    }

    console.log('✅ DB initialization complete.');
  } finally {
    try {
      db.close();
    } catch (e) {
      void e;
    }
  }
}

void main();
