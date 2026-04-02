import { getDatabase } from '$lib/db/database';
import type { UserRow, SessionUser } from '$lib/types/api';
import { ensureError } from '$lib/ts-utils';
import { signId, verifySigned } from '$lib/auth/cookies';
import type { LayoutServerLoad } from './$types';
import { logEvent } from '$lib/server/logs';

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

function normalizeNom(fullName: string | undefined, fallbackId: string) {
	const name = (fullName || '').trim();
	return name || fallbackId;
}

/**
 * Load server-side: uniquement basé sur la session fournie par le provider (locals.auth())
 * - On récupère l'identité du provider
 * - On tente de trouver l'utilisateur local dans la table `users` via `id_user`
 * - Si absent, on crée une entrée automatiquement (first_login = 0, promo depuis le provider)
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
					return { session: { user: userInfo } };
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
			const fullName =
				typeof providerUser.name === 'string'
					? providerUser.name
					: `${providerUser.firstName || ''} ${providerUser.lastName || ''}`;
			const nom = normalizeNom(fullName, candidateId);
			const promoYear = parsePromo(rawProvider.promo);

			const insert = db.prepare(
				'INSERT INTO users (id_user, nom, role, id_photos, promo_year) VALUES (?, ?, ?, ?, ?)'
			);
			try {
				insert.run(candidateId, nom, 'user', null, promoYear);
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
				user: userInfo
			}
		};
	} catch (e: unknown) {
		const _err = ensureError(e);
		console.warn('Error while loading session from provider:', e);
		return { session: null };
	}
};
