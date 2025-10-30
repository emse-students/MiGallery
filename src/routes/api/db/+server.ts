import { json } from "@sveltejs/kit";
import { getDatabase } from "$lib/db/database";
import type { RequestHandler } from "@sveltejs/kit";

export const POST: RequestHandler = async ({ request }) => {
  try {
    const { sql, params } = await request.json();
    
    if (!sql) {
      return json({ error: "Requête SQL manquante" }, { status: 400 });
    }

    const db = getDatabase();
    const stmt = db.prepare(sql);
    
    // Déterminer si c'est une requête de lecture ou d'écriture
    const isWriteQuery = /^\s*(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)/i.test(sql);
    
    if (isWriteQuery) {
      // Pour les requêtes d'écriture, utiliser .run()
      const info = params ? stmt.run(...params) : stmt.run();
      return json({ 
        success: true, 
        changes: info.changes,
        lastInsertRowid: info.lastInsertRowid
      });
    } else {
      // Pour les requêtes de lecture, utiliser .all()
      const results = params ? stmt.all(...params) : stmt.all();
      return json({ success: true, data: results });
    }
  } catch (error) {
    console.error("Erreur SQL:", error);
    return json({ 
      success: false, 
      error: error instanceof Error ? error.message : "Erreur" 
    }, { status: 500 });
  }
};
