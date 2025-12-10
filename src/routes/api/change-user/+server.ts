import { json } from '@sveltejs/kit';

import { ensureError } from '$lib/ts-utils';
import type { RequestHandler } from '@sveltejs/kit';
import { signId } from '$lib/auth/cookies';
import { requireScope } from '$lib/server/permissions';

export const POST: RequestHandler = async (event) => {
	await requireScope(event, 'admin');
	const { request, cookies } = event;
	try {
		const { userId } = (await request.json()) as { userId: string | null | undefined };

		// Si userId est null, on supprime le cookie (déconnexion)
		if (userId === null || userId === undefined) {
			cookies.delete('current_user_id', { path: '/' });
			return json({ success: true });
		}

		// Signer l'ID utilisateur et stocker dans un cookie
		const signed = signId(String(userId));
		cookies.set('current_user_id', signed, {
			path: '/',
			httpOnly: true,
			sameSite: 'strict',
			secure: process.env.NODE_ENV === 'production',
			maxAge: 60 * 60 * 24 * 30 // 30 jours
		});

		return json({ success: true });
	} catch (error: unknown) {
		const _err = ensureError(error);
		console.error('Erreur changement utilisateur:', error);
		return json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Erreur'
			},
			{ status: 500 }
		);
	}
};
