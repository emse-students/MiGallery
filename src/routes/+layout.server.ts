import { getDatabase } from '$lib/db/database';
import { env } from '$env/dynamic/private';
import type { UserRow, SessionUser } from '$lib/types/api';
import { ensureError } from '$lib/ts-utils';
import { signId, verifySigned } from '$lib/auth/cookies';
import type { LayoutServerLoad } from './$types';
import { logEvent } from '$lib/server/logs';

/**
 * Load server-side: uniquement basé sur la session fournie par le provider (locals.auth())
 * - On récupère l'identité du provider
 * - On tente de trouver l'utilisateur local dans la table `users` via `id_user` ou `email`
 * - Si absent, on crée une entrée minimale automatiquement (first_login = 1)
 * - Aucun fallback via cookies n'est utilisé
 */
export const load: LayoutServerLoad = async (event) => {
	const { locals, cookies } = event;
	try {
		const db = getDatabase();

		const cookieSigned = cookies.get('current_user_id');
		const alumniEnabled = !!(env.ALUMNI_ISSUER && env.ALUMNI_CLIENT_ID && env.ALUMNI_CLIENT_SECRET);

		if (cookieSigned) {
			const verified = verifySigned(cookieSigned);
			if (verified) {
				const userInfo = db.prepare('SELECT * FROM users WHERE id_user = ? LIMIT 1').get(verified) as
					| UserRow
					| undefined;
				if (userInfo) {
					return { session: { user: userInfo }, alumniEnabled };
				}
			}
		}

		if (!locals || typeof locals.auth !== 'function') {
			return { session: null, alumniEnabled };
		}

		const session = await locals.auth();
		if (!session || !session.user) {
			return { session: null, alumniEnabled };
		}

		const providerUser: SessionUser = {
			...session.user,
			email: typeof session.user.email === 'string' ? session.user.email : undefined
		};

		const candidateId =
			providerUser.id ||
			providerUser.preferred_username ||
			providerUser.sub ||
			(providerUser.email ? String(providerUser.email).split('@')[0] : undefined);

		if (!candidateId) {
			return { session };
		}

		let stmt = db.prepare('SELECT * FROM users WHERE id_user = ? LIMIT 1');
		let userInfo = stmt.get(candidateId) as UserRow | undefined;

		if (!userInfo && providerUser.email) {
			stmt = db.prepare('SELECT * FROM users WHERE email = ? LIMIT 1');
			userInfo = stmt.get(providerUser.email) as UserRow | undefined;
		}

		if (!userInfo) {
			const prenom =
				providerUser.given_name ||
				providerUser.prenom ||
				(providerUser.name ? String(providerUser.name).split(' ')[0] : '');
			const nom =
				providerUser.family_name ||
				providerUser.nom ||
				(providerUser.name ? String(providerUser.name).split(' ').slice(1).join(' ') : '');
			const email = providerUser.email || `${candidateId}@etu.emse.fr`;

			const insert = db.prepare(
				'INSERT INTO users (id_user, email, prenom, nom, role, id_photos, first_login, promo_year) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
			);
			try {
				insert.run(candidateId, email, prenom, nom, 'user', null, 1, null);
			} catch (_e) {
				console.warn('Auto-create in layout failed:', _e);
			}

			userInfo = db.prepare('SELECT * FROM users WHERE id_user = ? LIMIT 1').get(candidateId) as
				| UserRow
				| undefined;
		}

		if (!userInfo) {
			return { session };
		}

		try {
			const signed = signId(String(userInfo.id_user));
			const isNewCookie = !cookies.get('current_user_id');
			cookies.set('current_user_id', signed, {
				httpOnly: true,
				secure: String(process.env.NODE_ENV) === 'production',
				sameSite: 'lax',
				path: '/',
				maxAge: 60 * 60 * 24 * 30 // 30 days
			});

			if (isNewCookie) {
				await logEvent(event, 'login', 'user', userInfo.id_user, {
					method: 'provider',
					email: userInfo.email
				});
			}
		} catch (e: unknown) {
			const _err = ensureError(e);
			console.warn('Failed to set current_user_id cookie', e);
		}

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
		}

		return {
			session: {
				user: userInfo
			},
			alumniEnabled
		};
	} catch (e: unknown) {
		const _err = ensureError(e);
		console.warn('Error while loading session from provider:', e);
		return { session: null, alumniEnabled: false };
	}
};
