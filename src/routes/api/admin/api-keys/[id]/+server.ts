import { json } from '@sveltejs/kit';

import { ensureError } from '$lib/ts-utils';
import type { RequestHandler } from './$types';
import { revokeApiKey } from '$lib/db/api-keys';
import { ensureAdmin } from '$lib/server/auth';

export const DELETE: RequestHandler = async ({ locals, cookies, params }) => {
	try {
		const caller = await ensureAdmin({ locals, cookies });
		if (!caller) {
			return json({ error: 'Unauthorized' }, { status: 401 });
		}

		const id = Number(params.id);
		if (!id) {
			return json({ error: 'Bad Request' }, { status: 400 });
		}

		const changes = revokeApiKey(id);
		return json({ success: true, changes });
	} catch (e: unknown) {
		const _err = ensureError(e);
		console.error('DELETE /api/admin/api-keys/:id error', e);
		return json({ success: false, error: (e as Error).message }, { status: 500 });
	}
};
