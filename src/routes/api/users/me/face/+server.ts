import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getDatabase } from '$lib/db/database';
import { verifySigned } from '$lib/auth/cookies';
import { requireScope } from '$lib/server/permissions';
import { createLogger } from '$lib/server/logger';
import { m } from '$lib/paraglide/messages';

const SESSION_COOKIE_NAME = '__session_user';
const log = createLogger('user-face');

/**
 * PATCH /api/users/me/face
 * Updates the person ID (photos_id) and first_login status of the logged-in user
 *
 * Body:
 * - person_id: string | null (required) - The person ID to associate
 * - user_id: string (optional, admin only) - Allows editing another user
 */
export const PATCH: RequestHandler = async (event) => {
	const { request, locals, cookies } = event;

	const auth = await requireScope(event, 'read');

	try {
		const db = getDatabase();
		const body = (await request.json()) as {
			person_id?: string | null;
			user_id?: string;
			photos_asset_id?: string | null;
		};

		let userId: string | null = null;

		// A session-authenticated admin gets grantedScope 'read' here (requireScope
		// only returns 'admin' for the 'admin' required-scope or an admin API key),
		// so gate cross-user edits on the actual role, not the granted scope.
		const isAdmin = auth.grantedScope === 'admin' || auth.user?.role === 'admin';

		if (isAdmin && body.user_id) {
			userId = body.user_id;
		} else {
			const cookieSigned = cookies.get('current_user_id') ?? null;
			userId = auth.user?.id_user ?? null;

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
		}

		if (!userId) {
			return json({ error: 'Unauthorized - no user identified' }, { status: 401 });
		}

		const personId = body.person_id;

		if (personId !== null && (personId === undefined || typeof personId !== 'string')) {
			return json({ error: 'person_id is required and must be a string or null' }, { status: 400 });
		}

		if (personId) {
			const existingUser = db
				.prepare('SELECT id_user FROM users WHERE photos_id = ? AND id_user != ?')
				.get(personId, userId) as { id_user: string } | undefined;

			if (existingUser) {
				return json(
					{
						error: 'face_already_assigned',
						message: m.face_already_assigned_msg()
					},
					{ status: 409 }
				);
			}
		}

		// photos_asset_id is optional: when the caller sets a profile photo it also
		// sends the backing Immich asset id, so /api/users/[username]/avatar can
		// generate MiGallery's own square crop from it. Only touched when present in
		// the body (a plain person association leaves it unchanged).
		const setAsset = Object.prototype.hasOwnProperty.call(body, 'photos_asset_id');
		const assetId = body.photos_asset_id ?? null;
		if (setAsset && assetId !== null && typeof assetId !== 'string') {
			return json({ error: 'photos_asset_id must be a string or null' }, { status: 400 });
		}

		const stmt = setAsset
			? db.prepare('UPDATE users SET photos_id = ?, photos_asset_id = ? WHERE id_user = ?')
			: db.prepare('UPDATE users SET photos_id = ? WHERE id_user = ?');
		const result = setAsset ? stmt.run(personId, assetId, userId) : stmt.run(personId, userId);

		if (result.changes === 0) {
			return json({ error: 'User not found' }, { status: 404 });
		}

		return json({ success: true, person_id: personId });
	} catch (e) {
		const err = e as Error;
		log.error('PATCH /api/users/me/face failed', { message: err.message, stack: err.stack });
		return json({ error: err.message }, { status: 500 });
	}
};
