import { getDatabase } from '$lib/db/database';
import type { UserRow, SessionUser } from '$lib/types/api';
import { ensureError } from '$lib/ts-utils';
import { signId, verifySigned } from '$lib/auth/cookies';
import type { LayoutServerLoad } from './$types';

/**
 * Load server-side: uniquement basé sur la session fournie par le provider (locals.auth())
 * - On récupère l'identité du provider
 * - On tente de trouver l'utilisateur local dans la table `users` via `id_user` ou `email`
 * - Si absent, on crée une entrée minimale automatiquement (first_login = 1)
 * - Aucun fallback via cookies n'est utilisé
 */
export const load: LayoutServerLoad = async ({ locals, cookies }) => {
	try {
		const db = getDatabase();

		// 1) Prefer signed cookie-based fast-path: cookie is HttpOnly and set after first successful auth
		const cookieSigned = cookies.get('current_user_id');
		if (cookieSigned) {
			const verified = verifySigned(cookieSigned);
			if (verified) {
				const userInfo = db.prepare('SELECT * FROM users WHERE id_user = ? LIMIT 1').get(verified) as
					| UserRow
					| undefined;
				if (userInfo) {
					return { session: { user: userInfo } };
				}
			}
			// fallback to provider if cookie invalid or references missing user
		}

		// 2) No valid cookie: call provider once, map to local DB and set secure cookie
		if (!locals || typeof locals.auth !== 'function') {
			return { session: null };
		}

		const session = await locals.auth();
		if (!session || !session.user) {
			return { session: null };
		}

		const providerUser: SessionUser = session.user;

		// Déterminer un identifiant provider stable (ordre d'essai)
		const candidateId =
			providerUser.id ||
			providerUser.preferred_username ||
			providerUser.sub ||
			(providerUser.email ? String(providerUser.email).split('@')[0] : undefined);

		if (!candidateId) {
			// Si on ne peut pas inférer d'id provider, retourner la session brute (sans mapping DB)
			return { session };
		}

		// Chercher par id_user
		let stmt = db.prepare('SELECT * FROM users WHERE id_user = ? LIMIT 1');
		let userInfo = stmt.get(candidateId) as UserRow | undefined;

		// Si non trouvé par id_user, tenter par email si fourni
		if (!userInfo && providerUser.email) {
			stmt = db.prepare('SELECT * FROM users WHERE email = ? LIMIT 1');
			userInfo = stmt.get(providerUser.email) as UserRow | undefined;
		}

		if (!userInfo) {
			// Créer un utilisateur minimal dans la base pour garder la cohérence
			const prenom =
				providerUser.given_name ||
				providerUser.prenom ||
				(providerUser.name ? String(providerUser.name).split(' ')[0] : '');
			const nom =
				providerUser.family_name ||
				providerUser.nom ||
				(providerUser.name ? String(providerUser.name).split(' ').slice(1).join(' ') : '');
			const email = providerUser.email || null;

			const insert = db.prepare(
				'INSERT INTO users (id_user, email, prenom, nom, role, id_photos, first_login, promo_year) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
			);
			try {
				insert.run(candidateId, email, prenom, nom, 'user', null, 1, null);
			} catch (_e) {
				void _e;
				// ignore duplicate errors race-condition; we'll re-query
			}

			userInfo = db.prepare('SELECT * FROM users WHERE id_user = ? LIMIT 1').get(candidateId) as
				| UserRow
				| undefined;
		}

		if (!userInfo) {
			// En dernier recours, renvoyer la session provider brute
			return { session };
		}

		// Set a secure, HttpOnly cookie so we don't need to call provider on every request
		try {
			const signed = signId(String(userInfo.id_user));
			cookies.set('current_user_id', signed, {
				httpOnly: true,
				secure: String(process.env.NODE_ENV) === 'production',
				sameSite: 'lax',
				path: '/',
				maxAge: 60 * 60 * 24 * 30 // 30 days
			});
		} catch (e: unknown) {
			const _err = ensureError(e);
			console.warn('Failed to set current_user_id cookie', e);
		}

		// Logging utile pour debug: providerUser minimal et userInfo mappé (sans exposer secrets)
		try {
			console.warn(
				'[session] provider id:',
				providerUser?.id || providerUser?.preferred_username || providerUser?.sub,
				'email:',
				providerUser?.email
			);
			console.warn('[session] mapped local user:', { id_user: userInfo.id_user, role: userInfo.role });
		} catch (_e) {
			void _e;
			// ignore
		}

		return {
			session: {
				user: userInfo
			}
		};
	} catch (e: unknown) {
		const _err = ensureError(e);
		console.warn('Error while loading session from provider:', e);
		return { session: null };
	}
};
