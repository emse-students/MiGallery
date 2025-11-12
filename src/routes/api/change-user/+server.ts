import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";

export const POST: RequestHandler = async ({ request, cookies }) => {
  try {
    const { userId } = await request.json();
    
    if (!userId) {
      return json({ error: "userId manquant" }, { status: 400 });
    }

    // Stocker l'ID utilisateur dans un cookie
    cookies.set('current_user_id', userId, {
      path: '/',
      httpOnly: true,
      sameSite: 'strict',
      maxAge: 60 * 60 * 24 * 30 // 30 jours
    });

    return json({ success: true });
  } catch (error) {
    console.error("Erreur changement utilisateur:", error);
    return json({ 
      success: false, 
      error: error instanceof Error ? error.message : "Erreur" 
    }, { status: 500 });
  }
};
