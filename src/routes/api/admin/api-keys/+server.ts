import { json } from '@sveltejs/kit';

import { ensureError } from '$lib/ts-utils';
import type { RequestHandler } from './$types';
import { createApiKey, listApiKeys } from '$lib/db/api-keys';
import { requireScope } from '$lib/server/permissions';

export const GET: RequestHandler = async (event) => {
	await requireScope(event, 'admin');
	try {
		const rows = listApiKeys();
		return json({ success: true, keys: rows });
	} catch (e: unknown) {
		const err = ensureError(e);
		console.error('GET /api/admin/api-keys error', err);
		return json({ success: false, error: err.message }, { status: 500 });
	}
};

export const POST: RequestHandler = async (event) => {
	await requireScope(event, 'admin');
	try {
		const body = (await event.request.json()) as { label?: string; scopes?: string[] };
		const { label, scopes } = body;
		const { id, rawKey } = createApiKey(label, Array.isArray(scopes) ? scopes : undefined);
		return json({ success: true, id, rawKey });
	} catch (e: unknown) {
		const err = ensureError(e);
		console.error('POST /api/admin/api-keys error', err);
		return json({ success: false, error: err.message }, { status: 500 });
	}
};
