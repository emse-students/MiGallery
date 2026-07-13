import { json } from '@sveltejs/kit';

import { ensureError } from '$lib/ts-utils';
import type { RequestHandler } from '@sveltejs/kit';
import { signId } from '$lib/auth/cookies';
import { requireScope } from '$lib/server/permissions';

import { createLogger } from '$lib/server/logger';

const log = createLogger('change-user');
export const POST: RequestHandler = async (event) => {
	const { request, cookies } = event;
	try {
		const { userId } = (await request.json()) as { userId: string | null | undefined };

		// If userId is null, delete the cookie (logout)
		if (userId === null || userId === undefined) {
			cookies.delete('current_user_id', { path: '/' });
			return json({ success: true });
		}

		// To set another userId (impersonation), you must be admin
		await requireScope(event, 'admin');

		// Sign the user ID and store it in a cookie
		const signed = signId(String(userId));
		cookies.set('current_user_id', signed, {
			path: '/',
			httpOnly: true,
			sameSite: 'strict',
			secure: String(process.env.NODE_ENV) === 'production',
			maxAge: 60 * 60 * 24 * 30 // 30 jours
		});

		return json({ success: true });
	} catch (error: unknown) {
		const _err = ensureError(error);
		log.error('Error changing user:', error);
		return json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Error'
			},
			{ status: 500 }
		);
	}
};
