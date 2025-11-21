import { json, error } from '@sveltejs/kit';
import type { UserRow } from '$lib/types/api';
import { ensureError } from '$lib/ts-utils';
import type { RequestHandler } from './$types';
import { getDatabase } from '$lib/db/database';
import { verifySigned } from '$lib/auth/cookies';
import { execSync } from 'child_process';
import path from 'path';

import type { Cookies } from '@sveltejs/kit';

async function getUserFromLocals(locals: App.Locals, cookies: Cookies): Promise<UserRow | null> {
	const db = getDatabase();
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

export const GET: RequestHandler = async ({ locals, cookies }) => {
	const user = await getUserFromLocals(locals, cookies);

	if (!user?.role || user.role !== 'admin') {
		throw error(403, 'Accès refusé');
	}

	try {
		const scriptPath = path.join(process.cwd(), 'scripts', 'inspect-db.cjs');
		const output = execSync(`node "${scriptPath}"`, { encoding: 'utf-8' });

		// Parser la sortie pour détecter les erreurs
		const hasErrors = output.includes('❌') || output.includes('Erreurs détectées');
		const errors = hasErrors ? ['Voir les logs pour plus de détails'] : [];

		return json({
			success: !hasErrors,
			hasErrors,
			errors,
			output
		});
	} catch (e: unknown) {
		const err = ensureError(e);
		// Le script retourne exit(1) en cas d'erreur, donc catch est déclenché
		const errOutput = e && typeof e === 'object' && 'stdout' in e ? String(e.stdout) : err.message;
		const hasErrors = true;

		return json({
			success: false,
			hasErrors,
			errors: ['Erreurs détectées dans la base de données'],
			output: errOutput
		});
	}
};
