import { dev } from '$app/environment';
import type { UserRow } from '$lib/types/api';
import { getDatabase } from '$lib/db/database';
import { signId } from '$lib/auth/cookies';
import type { RequestHandler } from './$types';
import { redirect } from '@sveltejs/kit';

/**
 * Dev-only helper: set the signed `current_user_id` cookie so you can act as a local user.
 * Usage (dev only): GET /dev/login-as?u=<user_id>
 *
 * SÉCURITÉ :
 * - En développement (npm run dev) : Toujours activé
 * - En production : Désactivé par défaut, retourne 404
 * - Pour activer en prod : Ajouter ENABLE_DEV_ROUTES=true dans .env (⚠️ DANGEREUX)
 *
 * RECOMMANDATION : Ne JAMAIS activer en production sauf pour débogage temporaire supervisé.
 */
export const GET: RequestHandler = ({ url, cookies }) => {
	// Allow dev routes if in dev mode OR if explicitly enabled in production
	const allowDevRoutes = dev || process.env.ENABLE_DEV_ROUTES === 'true';

	if (!allowDevRoutes) {
		return new Response('Not found', { status: 404 });
	}

	const username = url.searchParams.get('u');
	if (!username) {
		return new Response('Missing parameter: u (username)', { status: 400 });
	}
	const db = getDatabase();

	const user = db.prepare('SELECT * FROM users WHERE id_user = ? LIMIT 1').get(username) as
		| UserRow
		| undefined;
	if (!user) {
		// Do NOT create or promote users in this dev helper anymore.
		return new Response(
			`User ${username} not found in local DB. Create the user first (do not use this route to create/promote).`,
			{ status: 404 }
		);
	}

	const signed = signId(String(user.id_user));
	cookies.set('current_user_id', signed, {
		httpOnly: true,
		secure: process.env.NODE_ENV === 'production',
		sameSite: 'lax',
		path: '/',
		maxAge: 60 * 60 * 24 * 30 // 30 days
	});

	// Redirect back to home where the layout will pick up the cookie and map the user
	throw redirect(303, '/');
};
