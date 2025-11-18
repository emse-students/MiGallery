import { getDatabase } from '$lib/db/database';
import { signId } from '$lib/auth/cookies';
import { ensureAdmin } from '$lib/server/auth-helpers';
import type { RequestHandler } from './$types';
import { redirect } from '@sveltejs/kit';

/**
 * Admin-only helper: set the signed `current_user_id` cookie to impersonate another user.
 * Usage: GET /admin/login-as?u=jolan.boudin
 * Requires: Current user must be admin
 */
export const GET: RequestHandler = async ({ url, cookies, locals }) => {
    // Vérifier que l'utilisateur actuel est admin
    await ensureAdmin(locals);

    const username = url.searchParams.get('u');
    if (!username) {
        return new Response('Missing parameter: u (username)', { status: 400 });
    }

    const db = getDatabase();
    const user = db.prepare('SELECT * FROM users WHERE id_user = ? LIMIT 1').get(username) as any;
    
    if (!user) {
        return new Response(`User ${username} not found in database.`, { status: 404 });
    }

    const signed = signId(String(user.id_user));
    cookies.set('current_user_id', signed, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 30 // 30 days
    });

    // Redirect to home where the layout will pick up the new cookie
    throw redirect(303, '/');
};
