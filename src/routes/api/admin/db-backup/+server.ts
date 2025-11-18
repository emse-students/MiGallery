import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDatabase } from '$lib/db/database';
import { verifySigned } from '$lib/auth/cookies';
import type { User } from '$lib/db/database';
import { execSync } from 'child_process';
import path from 'path';

async function getUserFromLocals(locals: any, cookies: any): Promise<User | null> {
	const db = getDatabase();
	const cookieSigned = cookies.get('current_user_id');
	if (cookieSigned) {
		const verified = verifySigned(cookieSigned);
		if (verified) {
			const userInfo = db.prepare("SELECT * FROM users WHERE id_user = ? LIMIT 1").get(verified) as User | null;
			if (userInfo) return userInfo;
		}
	}
	if (locals && typeof locals.auth === 'function') {
		const session = await locals.auth();
		if (session?.user) {
			const providerId = (session.user as any).id || (session.user as any).preferred_username || (session.user as any).sub;
			if (providerId) {
				const userInfo = db.prepare("SELECT * FROM users WHERE id_user = ? LIMIT 1").get(providerId) as User | null;
				if (userInfo) return userInfo;
			}
		}
	}
	return null;
}

export const POST: RequestHandler = async ({ locals, cookies }) => {
	const user = await getUserFromLocals(locals, cookies);
	
	if (!user?.role || user.role !== 'admin') {
		throw error(403, 'Accès refusé');
	}

	try {
		const scriptPath = path.join(process.cwd(), 'scripts', 'backup-db.cjs');
		const output = execSync(`node "${scriptPath}"`, { encoding: 'utf-8' });

		return json({
			success: true,
			message: 'Sauvegarde créée avec succès',
			output: output
		});
	} catch (err: any) {
		console.error('Error running backup:', err);
		throw error(500, err.message || 'Erreur lors de la sauvegarde');
	}
};
