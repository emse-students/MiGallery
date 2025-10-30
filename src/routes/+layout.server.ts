import { getDatabase } from "$lib/db/database";
import type { User } from "$lib/db/database";

export const load = async ({ locals, cookies }) => {

    /*const session = await locals.auth();
    return {
        session
    };*/

    // Lire l'utilisateur depuis le cookie, sinon utiliser l'utilisateur par défaut
    const userId = cookies.get('current_user_id') || "jolan.boudin";
    
    // Requête SQL pour récupérer toutes les infos de l'utilisateur
    const db = getDatabase();
    const stmt = db.prepare("SELECT * FROM users WHERE id_user = ?");
    const userInfo = stmt.get(userId) as User | null;

    return {
        session: {
            user: userInfo
        }
    }
}