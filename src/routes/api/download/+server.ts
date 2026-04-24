import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireScope } from '$lib/server/permissions';
import { createDownloadToken } from '$lib/server/download-tokens';

export const POST: RequestHandler = async (event) => {
	await requireScope(event, 'read');

	const body = (await event.request.json()) as { assetIds?: string[]; filename?: string };
	const { assetIds, filename } = body;

	if (!Array.isArray(assetIds) || assetIds.length === 0) {
		throw error(400, 'assetIds must be a non-empty array');
	}

	const token = createDownloadToken(assetIds, filename || 'album');
	return json({ token });
};
