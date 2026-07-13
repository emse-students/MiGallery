import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getDatabase } from '$lib/db/database';
import { verifySigned } from '$lib/auth/cookies';
import { requireScope } from '$lib/server/permissions';
import { isLocale } from '$lib/paraglide/runtime';
import { createLogger } from '$lib/server/logger';

const log = createLogger('users-me-locale');
const SESSION_COOKIE_NAME = '__session_user';

/**
 * PATCH /api/users/me/locale
 * Persists the preferred UI language of the logged-in user so the choice
 * follows their account across devices. The PARAGLIDE_LOCALE cookie is still
 * written client-side by setLocale(); this only records the durable preference.
 */
export const PATCH: RequestHandler = async (event) => {
	const { request, locals, cookies } = event;

	const auth = await requireScope(event, 'read');

	try {
		const db = getDatabase();

		const cookieSigned = cookies.get('current_user_id') ?? null;
		let userId: string | null = auth.user?.id_user ?? null;

		if (cookieSigned) {
			const verified = verifySigned(cookieSigned);
			if (verified) {
				userId = verified;
			}
		}

		if (!userId) {
			const sessionUserId = cookies.get(SESSION_COOKIE_NAME) ?? null;
			if (sessionUserId) {
				userId = sessionUserId;
			}
		}

		if (!userId) {
			const localUser = locals.user as { id?: string; id_user?: string } | null | undefined;
			userId = localUser?.id_user || localUser?.id || null;
		}

		if (!userId) {
			return json({ error: 'Unauthorized' }, { status: 401 });
		}

		const body = (await request.json()) as { locale?: string };
		const locale = body.locale;

		if (!locale || !isLocale(locale)) {
			return json({ error: 'Invalid locale' }, { status: 400 });
		}

		const result = db.prepare('UPDATE users SET locale = ? WHERE id_user = ?').run(locale, userId);

		if (result.changes === 0) {
			return json({ error: 'User not found' }, { status: 404 });
		}

		return json({ success: true, locale });
	} catch (e) {
		const err = e as Error;
		log.error('PATCH /api/users/me/locale error', err);
		return json({ error: err.message }, { status: 500 });
	}
};
