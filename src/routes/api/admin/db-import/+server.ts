import { json, error } from '@sveltejs/kit';
import { ensureError } from '$lib/ts-utils';
import type { RequestHandler } from './$types';
import { requireScope } from '$lib/server/permissions';
import fs from 'fs';
import path from 'path';

export const POST: RequestHandler = async (event) => {
	await requireScope(event, 'admin');

	const { request } = event;

	try {
		const formData = await request.formData();
		const file = formData.get('file') as File;

		if (!file || !file.name.endsWith('.db')) {
			throw error(400, 'Fichier invalide. Veuillez fournir un fichier .db');
		}

		const DB_PATH = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'migallery.db');
		const BACKUP_PATH = `${DB_PATH}.before-import.${Date.now()}`;

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
	} catch (e: unknown) {
		const err = ensureError(e);
		console.error('Error importing database:', err);
		throw error(500, err.message || "Erreur lors de l'import de la base de données");
	}
};
