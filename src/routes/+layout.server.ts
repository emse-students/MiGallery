import { getDatabase } from '$lib/db/database';
import type { UserRow } from '$lib/types/api';
import { verifySigned } from '$lib/auth/cookies';
import type { LayoutServerLoad } from './$types';

const SESSION_COOKIE_NAME = '__session_user';

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

export const load: LayoutServerLoad = async (event) => {
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
