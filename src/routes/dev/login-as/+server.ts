import { dev } from '$app/environment';
import type { UserRow } from '$lib/types/api';
import { getDatabase } from '$lib/db/database';
import { signId } from '$lib/auth/cookies';
import type { RequestHandler } from './$types';

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
	const allowDevRoutes =
		dev || process.env.ENABLE_DEV_ROUTES === 'true' || process.env.NODE_ENV === 'test';

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
		if (process.env.NODE_ENV === 'test' && username === 'les.roots') {
			try {
				db
					.prepare(
						'INSERT OR IGNORE INTO users (id_user, email, prenom, nom, role, promo_year) VALUES (?, ?, ?, ?, ?, ?)'
					)
					.run(username, 'les.roots@local', 'System', 'Root', 'admin', null);
			} catch (e) {
				return new Response(`Failed to create system user: ${(e as Error).message}`, { status: 500 });
			}

			const created = db.prepare('SELECT * FROM users WHERE id_user = ? LIMIT 1').get(username) as
				| UserRow
				| undefined;
			if (!created) {
				return new Response(`User ${username} not found after creation attempt.`, { status: 500 });
			}

			const signed = signId(String(created.id_user));

			cookies.delete('current_user_id', { path: '/' });

			cookies.set('current_user_id', signed, {
				httpOnly: true,
				secure: !dev,
				sameSite: 'lax',
				path: '/',
				maxAge: 60 * 60 * 24 * 30 // 30 days
			});

			return new Response(
				`<html><head><meta http-equiv="refresh" content="1;url=/"></head><body>Redirecting...<script>
		window.location.replace('/?t=' + Date.now());
		window.addEventListener('pageshow', () => {
			if (window.location.search.startsWith('?t=')) {
				window.history.replaceState({}, '', '/');
			}
		});
		</script></body></html>`,
				{
					headers: {
						'Content-Type': 'text/html',
						'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
						Pragma: 'no-cache',
						Expires: '0'
					}
				}
			);
		}

		return new Response(
			`User ${username} not found in local DB. Create the user first (do not use this route to create/promote).`,
			{ status: 404 }
		);
	}

	const signed = signId(String(user.id_user));

	// Force delete first to ensure clean state
	cookies.delete('current_user_id', { path: '/' });

	cookies.set('current_user_id', signed, {
		httpOnly: true,
		secure: !dev,
		sameSite: 'lax',
		path: '/',
		maxAge: 60 * 60 * 24 * 30 // 30 days
	});

	return new Response(
		'<html><head><meta http-equiv="refresh" content="1;url=/"></head><body>Redirecting...<script>window.location.replace("/?t=" + Date.now())</script></body></html>',
		{
			headers: {
				'Content-Type': 'text/html',
				'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
				Pragma: 'no-cache',
				Expires: '0'
			}
		}
	);
};
