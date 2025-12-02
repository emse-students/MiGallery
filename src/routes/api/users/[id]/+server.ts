import { json } from '@sveltejs/kit';
import type { UserRow } from '$lib/types/api';
import { ensureError } from '$lib/ts-utils';
import type { RequestHandler } from './$types';
import { getDatabase } from '$lib/db/database';
import { verifySigned } from '$lib/auth/cookies';

import type { Cookies } from '@sveltejs/kit';

async function getUserFromLocals(locals: App.Locals, cookies: Cookies): Promise<UserRow | null> {
	const db = getDatabase();

	// Try cookie first (fast path)
	const cookieSigned = cookies.get('current_user_id');
	if (cookieSigned) {
		const verified = verifySigned(cookieSigned);
		if (verified) {
			const userInfo = db.prepare('SELECT * FROM users WHERE id_user = ? LIMIT 1').get(verified) as
				| UserRow
				| undefined;
			if (userInfo) {
				return userInfo;
			}
		}
	}

	// Fallback to auth provider
	if (locals && typeof locals.auth === 'function') {
		const session = await locals.auth();
		if (session?.user) {
			const providerId = session.user.id || session.user.preferred_username || session.user.sub;
			if (providerId) {
				const userInfo = db.prepare('SELECT * FROM users WHERE id_user = ? LIMIT 1').get(providerId) as
					| UserRow
					| undefined;
				if (userInfo) {
					return userInfo;
				}
			}
		}
	}

	return null;
}

export const GET: RequestHandler = async ({ params, locals, cookies, request }) => {
	// get user by id - admin or self
	try {
		// allow admin via API key header
		const apiKeyHeader = request.headers.get('x-api-key') || request.headers.get('X-API-KEY');
		let caller: UserRow | null = null;
		if (apiKeyHeader) {
			const { verifyRawKeyWithScope } = await import('$lib/db/api-keys');
			if (!verifyRawKeyWithScope(apiKeyHeader, 'admin')) {
				return json({ error: 'Unauthorized' }, { status: 401 });
			}
			// caller remains null but admin privileges allowed via API key
		} else {
			caller = await getUserFromLocals(locals, cookies);
			if (!caller) {
				return json({ error: 'Unauthorized' }, { status: 401 });
			}
		}

		const targetId = params.id;
		if (!targetId) {
			return json({ error: 'Bad Request' }, { status: 400 });
		}

		if (caller && (caller.role || 'user') !== 'admin' && caller.id_user !== targetId) {
			return json({ error: 'Forbidden' }, { status: 403 });
		}

		const db = getDatabase();
		const row = db
			.prepare(
				'SELECT id_user, email, prenom, nom, id_photos, role, promo_year FROM users WHERE id_user = ? LIMIT 1'
			)
			.get(targetId);
		if (!row) {
			return json({ error: 'Not Found' }, { status: 404 });
		}
		return json({ success: true, user: row });
	} catch (e: unknown) {
		const err = ensureError(e);
		console.error('GET /api/users/[id] error', err);
		return json({ success: false, error: err.message }, { status: 500 });
	}
};

export const PUT: RequestHandler = async ({ params, request, locals, cookies }) => {
	// update user - admin or self (self can update non-sensitive fields)
	try {
		// Debug logs: trace incoming request to help diagnose 401/403
		try {
			const maskedCookie = (() => {
				const c = cookies.get('current_user_id');
				if (!c) {
					return null;
				}
				const idx = c.indexOf('.');
				return idx === -1 ? '[signed?]' : `${c.slice(0, Math.min(idx, 20))}...`;
			})();
			console.debug('[PUT /api/users/:id] start', {
				paramsId: params?.id,
				cookiePresent: !!cookies.get('current_user_id'),
				cookieMasked: maskedCookie,
				xApiKey: request.headers.get('x-api-key') || request.headers.get('X-API-KEY') || null,
				localsAuth: typeof locals?.auth === 'function'
			});
		} catch (logErr) {
			// don't fail on logging
			console.warn('[PUT /api/users/:id] logging error', logErr);
		}
		const caller = await getUserFromLocals(locals, cookies);
		console.debug('[PUT /api/users/:id] caller resolved', {
			caller: caller ? { id_user: caller.id_user, role: caller.role } : null
		});
		if (!caller) {
			console.warn('[PUT /api/users/:id] unauthorized: no caller');
			return json({ error: 'Unauthorized' }, { status: 401 });
		}

		const targetId = params.id;
		if (!targetId) {
			return json({ error: 'Bad Request' }, { status: 400 });
		}

		// Allow admins to update any user. Non-admins may update their own record,
		// but are not allowed to change sensitive fields like `role` or `promo_year`.
		if ((caller.role || 'user') !== 'admin' && caller.id_user !== targetId) {
			return json({ error: 'Forbidden' }, { status: 403 });
		}

		const body = (await request.json()) as {
			email?: string;
			prenom?: string;
			nom?: string;
			role?: string;
			promo_year?: number | null;
			id_photos?: string | null;
		};
		const { email, prenom, nom, role, promo_year, id_photos } = body;

		// If caller is not admin, prevent changing admin-only fields
		if ((caller.role || 'user') !== 'admin') {
			if (role !== undefined || promo_year !== undefined) {
				console.warn(
					'[PUT /api/users/:id] forbidden: non-admin attempted to change admin-only fields',
					{ caller: caller.id_user, target: params.id }
				);
				return json({ error: 'Forbidden' }, { status: 403 });
			}
		}

		const db = getDatabase();
		const stmt = db.prepare(
			'UPDATE users SET email = ?, prenom = ?, nom = ?, role = ?, promo_year = ?, id_photos = ? WHERE id_user = ?'
		);
		const info = stmt.run(
			email || null,
			prenom || null,
			nom || null,
			// keep existing role for non-admins (role must be provided by admin)
			(caller.role || 'user') === 'admin'
				? role || 'user'
				: caller.id_user === targetId
					? (body.role ??
						((
							db.prepare('SELECT role FROM users WHERE id_user = ?').get(targetId) as
								| { role: string }
								| undefined
						)?.role ||
							'user'))
					: role || 'user',
			promo_year || null,
			id_photos || null,
			targetId
		);
		const updated = db
			.prepare(
				'SELECT id_user, email, prenom, nom, id_photos, role, promo_year FROM users WHERE id_user = ?'
			)
			.get(targetId);
		return json({ success: true, updated, changes: info.changes });
	} catch (e: unknown) {
		const err = ensureError(e);
		console.error('PUT /api/users/[id] error', err);
		return json({ success: false, error: err.message }, { status: 500 });
	}
};

export const DELETE: RequestHandler = async ({ params, locals, cookies }) => {
	// delete user - admin only
	try {
		const caller = await getUserFromLocals(locals, cookies);
		if (!caller) {
			return json({ error: 'Unauthorized' }, { status: 401 });
		}
		if ((caller.role || 'user') !== 'admin') {
			return json({ error: 'Forbidden' }, { status: 403 });
		}

		const targetId = params.id;
		const db = getDatabase();
		const info = db.prepare('DELETE FROM users WHERE id_user = ?').run(targetId);
		return json({ success: true, changes: info.changes });
	} catch (e: unknown) {
		const err = ensureError(e);
		console.error('DELETE /api/users/[id] error', err);
		return json({ success: false, error: err.message }, { status: 500 });
	}
};
