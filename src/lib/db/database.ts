import { readFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";

const DB_PATH = process.env.DATABASE_PATH || "./data/migallery.db";

// Type-safe database interface (works with both better-sqlite3 and bun:sqlite)
type DatabaseInstance = {
  prepare: (sql: string) => any;
  exec: (sql: string) => void;
  run?: (sql: string) => void;
  close?: () => void;
};

let db: DatabaseInstance | null = null;

// Detect runtime environment
function isBunRuntime(): boolean {
  return typeof (globalThis as any).Bun !== 'undefined';
}

export function getDatabase(): DatabaseInstance {
  if (!db) {
    const dir = dirname(DB_PATH);
    
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Create database with appropriate driver
    let dbInstance: DatabaseInstance;
    if (isBunRuntime()) {
      // Use bun:sqlite (native, built into Bun)
      const { Database } = require('bun:sqlite');
      dbInstance = new Database(DB_PATH);
    } else {
      // Use better-sqlite3 for Node.js
      const Database = require('better-sqlite3');
      dbInstance = new Database(DB_PATH);
    }
    
    // Ensure foreign key constraints are enabled
    try {
      dbInstance.exec('PRAGMA foreign_keys = ON');
    } catch (e) {
      // ignore if pragma not supported in environment
    }
    
    const schemaPath = join(process.cwd(), "src/lib/db/schema.sql");
    const schema = readFileSync(schemaPath, "utf-8");
    dbInstance.exec(schema);

      // Run simple migrations to add columns if they are missing (keeps existing DBs compatible)
      try {
        const cols = dbInstance.prepare("PRAGMA table_info(users)").all().map((c: any) => c.name);
        if (!cols.includes('role')) {
          dbInstance.prepare("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'").run();
        }
        if (!cols.includes('promo_year')) {
          dbInstance.prepare("ALTER TABLE users ADD COLUMN promo_year INTEGER").run();
        }
        // add visible column to albums if missing
        try {
          const acols = dbInstance.prepare("PRAGMA table_info(albums)").all().map((c: any) => c.name);
          if (acols.length > 0 && !acols.includes('visible')) {
            dbInstance.prepare("ALTER TABLE albums ADD COLUMN visible INTEGER NOT NULL DEFAULT 1").run();
          }
        } catch (e) {
          try { console.warn('DB migration (albums.visible) notice:', (e as Error).message); } catch {}
        }
        // Ensure api_keys table exists for external API key management
        try {
          const apiKeysExist = dbInstance.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='api_keys'").get();
          if (!apiKeysExist) {
            dbInstance.prepare(`CREATE TABLE api_keys (
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
      
      // Store the initialized database instance
      db = dbInstance;
  }
  
  // TypeScript assertion: db is guaranteed to be non-null here
  if (!db) {
    throw new Error('Database initialization failed');
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
