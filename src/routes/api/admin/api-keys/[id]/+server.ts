import { json } from '@sveltejs/kit';

import { ensureError } from '$lib/ts-utils';
import type { RequestHandler } from './$types';
import { deleteApiKey } from '$lib/db/api-keys';
import { requireScope } from '$lib/server/permissions';

import { createLogger } from '$lib/server/logger';

const log = createLogger('admin-api-keys-id');
export const DELETE: RequestHandler = async (event) => {
	await requireScope(event, 'admin');
	try {
		const id = Number(event.params.id);
		if (!id) {
			return json({ error: 'Not Found' }, { status: 404 });
		}

		const changes = deleteApiKey(id);
		if (changes === 0) {
			return json({ error: 'Not Found' }, { status: 404 });
		}
		return json({ success: true, changes });
	} catch (e: unknown) {
		const _err = ensureError(e);
		log.error('DELETE /api/admin/api-keys/:id error', e);
		return json({ success: false, error: (e as Error).message }, { status: 500 });
	}
};
