#!/usr/bin/env bun
import { getDatabase } from "../src/lib/db/database";

console.log("🚀 Initialisation de la base de données...\n");

try {
  const db = getDatabase();
  const stmt = db.prepare("SELECT * FROM users");
  const users = stmt.all();
  console.table(users);
  console.log("✅ Terminé!");
} catch (error) {
  console.error("❌ Erreur:", error);
  process.exit(1);
}
