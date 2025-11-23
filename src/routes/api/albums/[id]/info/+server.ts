// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { json, error as svelteError } from '@sveltejs/kit';

import { getDatabase } from '$lib/db/database';
import type { RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { verifyRawKeyWithScope } from '$lib/db/api-keys';
import { getCurrentUser } from '$lib/server/auth';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const IMMICH_BASE_URL = env.IMMICH_BASE_URL;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const IMMICH_API_KEY = env.IMMICH_API_KEY ?? '';

export const GET: RequestHandler = async ({ params, request, locals, cookies }) => {
	try {
		const { id } = params;

		// Autorisation: session utilisateur OU x-api-key avec scope "read"
		const user = await getCurrentUser({ locals, cookies });
		if (!user) {
			const raw = request.headers.get('x-api-key') || undefined;
			if (!verifyRawKeyWithScope(raw, 'read')) {
				return json({ error: 'Unauthorized' }, { status: 401 });
			}
		}
		if (!id) {
			return json({ error: 'Album ID manquant' }, { status: 400 });
		}

		const db = getDatabase();

		// Récupérer d'abord l'album depuis notre BDD locale (source de vérité)
		const albumRow = db
			.prepare('SELECT id, name, date, location, visibility, visible FROM albums WHERE id = ?')
			.get(id) as
			| {
					id: number;
					name: string;
					date?: string | null;
					location?: string | null;
					visibility?: string;
					visible?: boolean | number;
			  }
			| undefined;

		if (!albumRow) {
			return json({ error: 'Album non trouvé dans la base locale' }, { status: 404 });
		}

		// Charger les tags
		const tagsRows = db
			.prepare('SELECT tag FROM album_tag_permissions WHERE album_id = ?')
			.all(id) as { tag: string }[];

		// Charger les utilisateurs autorisés
		const usersRows = db
			.prepare('SELECT id_user FROM album_user_permissions WHERE album_id = ?')
			.all(id) as { id_user: number }[];

		return json({
			success: true,
			album: {
				id: albumRow.id,
				name: albumRow.name,
				date: albumRow.date || null,
				location: albumRow.location || null,
				visibility: albumRow.visibility || 'private',
				visible: albumRow.visible
			},
			tags: tagsRows.map((r) => r.tag),
			users: usersRows.map((r) => r.id_user)
		});
	} catch (err: unknown) {
		const errorMessage = err instanceof Error ? err.message : 'Erreur inconnue';
		console.error('Erreur chargement album info:', err);
		return json(
			{
				error: errorMessage
			},
			{ status: 500 }
		);
	}
};
