import { json, error } from '@sveltejs/kit';
import { ensureError } from '$lib/ts-utils';
import type { RequestHandler } from './$types';
import { requireScope } from '$lib/server/permissions';
import { resetDatabase } from '$lib/db/database';
import fs from 'fs';
import path from 'path';

export const POST: RequestHandler = async (event) => {
	await requireScope(event, 'admin');

	const { request } = event;

	try {
		const formData = await request.formData();
		const file = formData.get('file') as File | null;

		if (!file) {
			return error(400, 'Fichier manquant. Veuillez fournir un fichier.');
		}

		if (typeof file === 'string' || !file.name) {
			return error(400, 'Fichier invalide.');
		}

		if (!file.name.endsWith('.db')) {
			return error(400, 'Fichier invalide. Veuillez fournir un fichier .db');
		}

		const DB_PATH = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'migallery.db');
		const BACKUP_PATH = `${DB_PATH}.before-import.${Date.now()}`;

		resetDatabase();

		if (fs.existsSync(DB_PATH)) {
			fs.copyFileSync(DB_PATH, BACKUP_PATH);
		}

		const buffer = Buffer.from(await file.arrayBuffer());
		fs.writeFileSync(DB_PATH, buffer);

		return json({
			success: true,
			message: 'Base de données importée avec succès',
			backup: BACKUP_PATH
		});
	} catch (e: unknown) {
		const err = ensureError(e);
		console.error('Error importing database:', err);
		return error(400, "Fichier invalide. La base de données n'a pas pu être importée.");
	}
};
