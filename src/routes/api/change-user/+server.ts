import { json, isHttpError } from '@sveltejs/kit';

import { ensureError } from '$lib/ts-utils';
import type { RequestHandler } from '@sveltejs/kit';
import { requireScope } from '$lib/server/permissions';
import { canStopImpersonating } from '$lib/server/auth';
import { getSessionToken } from '$lib/session';
import { setSessionImpersonation } from '$lib/db/sessions';

import { createLogger } from '$lib/server/logger';

const log = createLogger('change-user');

/**
 * Start or stop impersonating, on the caller's own session.
 * Body: `{ userId }` to impersonate, `{ userId: null }` to stop.
 */
export const POST: RequestHandler = async (event) => {
	const { request, cookies, locals } = event;
	try {
		const { userId } = (await request.json()) as { userId: string | null | undefined };

		const token = getSessionToken(cookies);
		if (!token) {
			return json({ success: false, error: 'No session' }, { status: 401 });
		}

		// Stopping is judged on the REAL account, which is still the admin that
		// started the impersonation - see /admin/stop-impersonating.
		if (userId === null || userId === undefined) {
			if (!canStopImpersonating({ locals, cookies })) {
				return json({ success: false, error: 'Forbidden' }, { status: 403 });
			}
			setSessionImpersonation(token, null);

			return json({ success: true });
		}

		// Starting one requires being an admin right now.
		await requireScope(event, 'admin');
		setSessionImpersonation(token, String(userId));

		return json({ success: true });
	} catch (error: unknown) {
		// requireScope refuses with an HttpError - let it answer 403, not 500.
		if (isHttpError(error)) {
			throw error;
		}
		const err = ensureError(error);
		log.error('Error changing user:', err);
		return json({ success: false, error: err.message }, { status: 500 });
	}
};
