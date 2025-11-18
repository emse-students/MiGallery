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

export const GET: RequestHandler = async ({ locals, cookies }) => {
	const user = await getUserFromLocals(locals, cookies);
	
	if (!user?.role || user.role !== 'admin') {
		throw error(403, 'Accès refusé');
	}

	const DB_PATH = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'migallery.db');

	if (!fs.existsSync(DB_PATH)) {
		throw error(404, 'Base de données non trouvée');
	}

	try {
		const dbBuffer = fs.readFileSync(DB_PATH);
		const filename = `migallery_export_${new Date().toISOString().split('T')[0]}.db`;

		return new Response(dbBuffer, {
			headers: {
				'Content-Type': 'application/octet-stream',
				'Content-Disposition': `attachment; filename="${filename}"`,
				'Content-Length': dbBuffer.length.toString()
			}
		});
	} catch (err) {
		console.error('Error exporting database:', err);
		throw error(500, 'Erreur lors de l\'export de la base de données');
	}
};
