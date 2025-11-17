import Database from "better-sqlite3";
import { readFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";

const DB_PATH = process.env.DATABASE_PATH || "./data/migallery.db";

let db: Database.Database | null = null;

export function getDatabase(): Database.Database {
  if (!db) {
    const dir = dirname(DB_PATH);
    
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    db = new Database(DB_PATH);
    // Ensure foreign key constraints are enabled
    try {
      db.pragma('foreign_keys = ON');
    } catch (e) {
      // ignore if pragma not supported in environment
    }
    
    const schemaPath = join(process.cwd(), "src/lib/db/schema.sql");
    const schema = readFileSync(schemaPath, "utf-8");
    db.exec(schema);

      // Run simple migrations to add columns if they are missing (keeps existing DBs compatible)
      try {
        const cols = db.prepare("PRAGMA table_info(users)").all().map((c: any) => c.name);
        if (!cols.includes('role')) {
          db.prepare("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'").run();
        }
        if (!cols.includes('promo_year')) {
          db.prepare("ALTER TABLE users ADD COLUMN promo_year INTEGER").run();
        }
        // add visible column to albums if missing
        try {
          const acols = db.prepare("PRAGMA table_info(albums)").all().map((c: any) => c.name);
          if (acols.length > 0 && !acols.includes('visible')) {
            db.prepare("ALTER TABLE albums ADD COLUMN visible INTEGER NOT NULL DEFAULT 1").run();
          }
        } catch (e) {
          try { console.warn('DB migration (albums.visible) notice:', (e as Error).message); } catch {}
        }
        // Ensure api_keys table exists for external API key management
        try {
          const apiKeysExist = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='api_keys'").get();
          if (!apiKeysExist) {
            db.prepare(`CREATE TABLE api_keys (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              key_hash TEXT NOT NULL UNIQUE,
              label TEXT,
              scopes TEXT,
              revoked INTEGER NOT NULL DEFAULT 0,
              created_at INTEGER NOT NULL
            )`).run();
          }
        } catch (e) {
          try { console.warn('DB migration (api_keys) notice:', (e as Error).message); } catch {}
        }
      } catch (e) {
        // If users table doesn't exist yet (fresh DB), ignore - schema.sql will create it
        // If ALTER fails for some reason, log it for debugging
        try { console.warn('DB migration notice:', (e as Error).message); } catch {}
      }
  }
  
  return db;
}

export interface User {
  id_user: string;
  email: string;
  prenom: string;
  nom: string;
  id_photos: string | null;
  first_login: number;
  role?: 'admin' | 'mitviste' | 'user' | string;
  promo_year?: number | null;
}
