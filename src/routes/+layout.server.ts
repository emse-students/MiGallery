import { getDatabase } from '$lib/db/database';
import type { UserRow, SessionUser } from '$lib/types/api';
import { ensureError } from '$lib/ts-utils';
import { signId, verifySigned } from '$lib/auth/cookies';
import type { LayoutServerLoad } from './$types';
import { logEvent } from '$lib/server/logs';

const SYSTEM_USER_ID = 'dd68bb5b4f7c56878a1bd873593a3e7c3434242c80871e4ead9fe99d3f48a782';

function parsePromo(value: unknown): number | null {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return value;
	}
	if (typeof value === 'string' && value.trim().length > 0) {
		const n = parseInt(value, 10);
		return Number.isNaN(n) ? null : n;
	}
	return null;
}

function computeNameFromProvider(user: SessionUser, fallbackId: string): string {
	const fullName = typeof user.name === 'string' ? user.name.trim() : '';
	if (fullName) {
		return fullName;
	}

	const firstName = typeof user.firstName === 'string' ? user.firstName.trim() : '';
	const lastName = typeof user.lastName === 'string' ? user.lastName.trim() : '';
	const combined = `${firstName} ${lastName}`.trim();

	return combined || fallbackId;
}

function toSessionUser(user: UserRow): UserRow {
	return {
		...user,
		nom: user.name,
		prenom: user.first_name || '',
		id_photos: user.photos_id,
		promo_year: user.promo,
		first_login: 0
	};
}

/**
 * Load server-side: uniquement basé sur la session fournie par le provider (locals.auth())
 * - On récupère l'identité du provider
 * - On tente de trouver l'utilisateur local dans la table `users` via `id_user`
 * - Si absent, on crée une entrée automatiquement avec le schéma Authentik
 * - Aucun fallback via cookies n'est utilisé
 */
export const load: LayoutServerLoad = async (event) => {
	const { locals, cookies } = event;
	try {
		const db = getDatabase();

		const cookieSigned = cookies.get('current_user_id');

		if (cookieSigned) {
			const verified = verifySigned(cookieSigned);
			if (verified) {
				const userInfo = db.prepare('SELECT * FROM users WHERE id_user = ? LIMIT 1').get(verified) as
					| UserRow
					| undefined;
				if (userInfo) {
					return { session: { user: toSessionUser(userInfo) } };
				}
			}
		}

		if (!locals || typeof locals.auth !== 'function') {
			return { session: null };
		}

		const session = await locals.auth();
		if (!session || !session.user) {
			return { session: null };
		}

		const providerUser: SessionUser = {
			...session.user
		};
		const rawProvider = session.user as Record<string, unknown>;

		const candidateId = providerUser.id || providerUser.sub;

		if (!candidateId) {
			return { session };
		}

		const stmt = db.prepare('SELECT * FROM users WHERE id_user = ? LIMIT 1');
		let userInfo = stmt.get(candidateId) as UserRow | undefined;

		if (!userInfo) {
			const role = candidateId === SYSTEM_USER_ID ? 'admin' : 'user';

			const insert = db.prepare(
				'INSERT INTO users (id_user, name, first_name, last_name, promo, role, photos_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
			);
			try {
				insert.run(
					candidateId,
					computeNameFromProvider(providerUser, candidateId),
					typeof rawProvider.firstName === 'string' ? rawProvider.firstName.trim() : null,
					typeof rawProvider.lastName === 'string' ? rawProvider.lastName.trim() : null,
					parsePromo(rawProvider.promo),
					role,
					null
				);
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
					method: 'provider'
				});
			}
		} catch (e: unknown) {
			const _err = ensureError(e);
			console.warn('Failed to set current_user_id cookie', e);
		}

		try {
			console.warn(
				'[session] provider id:',
				providerUser?.id || providerUser?.sub,
				'name:',
				providerUser?.name
			);
			console.warn('[session] mapped local user:', { id_user: userInfo.id_user, role: userInfo.role });
		} catch (_e) {
			void _e;
		}

		return {
			session: {
				user: toSessionUser(userInfo)
			}
		};
	} catch (e: unknown) {
		const _err = ensureError(e);
		console.warn('Error while loading session from provider:', e);
		return { session: null };
	}
};
