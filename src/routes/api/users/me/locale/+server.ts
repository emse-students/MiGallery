import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getDatabase } from '$lib/db/database';
import { requireSession } from '$lib/server/permissions';
import { isLocale } from '$lib/paraglide/runtime';
import { createLogger } from '$lib/server/logger';

const log = createLogger('users-me-locale');

/**
 * PATCH /api/users/me/locale
 * Persists the preferred UI language of the logged-in user so the choice
 * follows their account across devices. The PARAGLIDE_LOCALE cookie is still
 * written client-side by setLocale(); this only records the durable preference.
 */
export const PATCH: RequestHandler = async (event) => {
  const { request } = event;

  // "me" is whoever the session says it is - there is no other answer to look for.
  const userId = (await requireSession(event)).id_user;

  try {
    const db = getDatabase();

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
