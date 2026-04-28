import { getDatabase } from '$lib/db/database';
import type { UserRow } from '$lib/types/api';
import { verifySigned } from '$lib/auth/cookies';
import type { LayoutServerLoad } from './$types';

const SESSION_COOKIE_NAME = '__session_user';

type SessionPageUser = NonNullable<NonNullable<App.PageData['session']>['user']>;
type SessionRole = NonNullable<SessionPageUser['role']>;

function normalizeRole(role: UserRow['role']): SessionRole {
	return role === 'admin' || role === 'mitviste' || role === 'user' ? role : 'user';
}

function toSessionUser(user: UserRow): SessionPageUser {
	return {
		id_user: user.id_user,
		name: user.name,
		first_name: user.first_name,
		last_name: user.last_name,
		photos_id: user.photos_id,
		role: normalizeRole(user.role),
		promo: user.promo,
		formation: user.formation,
		id_photos: user.photos_id,
		promo_year: user.promo,
		first_login: (user.first_login ?? 1) as number
	};
}

export const load: LayoutServerLoad = (event) => {
	const { cookies } = event;
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

		const sessionUserId = cookies.get(SESSION_COOKIE_NAME);
		if (!sessionUserId) {
			return { session: null };
		}

		const userInfo = db
			.prepare('SELECT * FROM users WHERE id_user = ? LIMIT 1')
			.get(sessionUserId) as UserRow | undefined;

		if (!userInfo) {
			return { session: null };
		}

		return {
			session: {
				user: toSessionUser(userInfo)
			}
		};
	} catch (e) {
		console.warn('Error while loading session from cookies:', e);
		return { session: null };
	}
};
