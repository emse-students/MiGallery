import { json } from "@sveltejs/kit";
import { getDatabase } from "$lib/db/database";
import type { RequestHandler } from "./photos/$types";

export const POST: RequestHandler = async ({ request }) => {
  try {
    const { sql, params } = await request.json();
    
    if (!sql) {
      return json({ error: "Requête SQL manquante" }, { status: 400 });
    }

    const db = getDatabase();
    const stmt = db.prepare(sql);
    
    const results = params ? stmt.all(...params) : stmt.all();
    
    return json({ success: true, data: results });
  } catch (error) {
    console.error("Erreur SQL:", error);
    return json({ 
      success: false, 
      error: error instanceof Error ? error.message : "Erreur" 
    }, { status: 500 });
  }
};
