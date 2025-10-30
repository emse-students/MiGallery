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
    
    const schemaPath = join(process.cwd(), "src/lib/db/schema.sql");
    const schema = readFileSync(schemaPath, "utf-8");
    db.exec(schema);
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
}
