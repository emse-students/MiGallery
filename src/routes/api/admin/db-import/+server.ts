import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDatabase } from '$lib/db/database';
import { verifySigned } from '$lib/auth/cookies';
import type { User } from '$lib/db/database';
import fs from 'fs';
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

export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	const user = await getUserFromLocals(locals, cookies);
	
	if (!user?.role || user.role !== 'admin') {
		throw error(403, 'Accès refusé');
	}

	try {
		const formData = await request.formData();
		const file = formData.get('file') as File;

		if (!file || !file.name.endsWith('.db')) {
			throw error(400, 'Fichier invalide. Veuillez fournir un fichier .db');
		}

		const DB_PATH = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'migallery.db');
		const BACKUP_PATH = DB_PATH + '.before-import.' + Date.now();

		// Sauvegarder la DB actuelle avant import
		if (fs.existsSync(DB_PATH)) {
			fs.copyFileSync(DB_PATH, BACKUP_PATH);
		}

		// Écrire le nouveau fichier
		const buffer = Buffer.from(await file.arrayBuffer());
		fs.writeFileSync(DB_PATH, buffer);

		return json({
			success: true,
			message: 'Base de données importée avec succès',
			backup: BACKUP_PATH
		});
	} catch (err: any) {
		console.error('Error importing database:', err);
		throw error(500, err.message || 'Erreur lors de l\'import de la base de données');
	}
};
