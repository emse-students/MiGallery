import { json, error } from '@sveltejs/kit';

import { ensureError } from '$lib/ts-utils';
import type { RequestHandler } from './$types';
import { getOrCreateSystemAlbum } from '$lib/immich/system-albums';
import { env } from '$env/dynamic/private';
import { requireScope } from '$lib/server/permissions';
const IMMICH_BASE_URL = env.IMMICH_BASE_URL;
const IMMICH_API_KEY = env.IMMICH_API_KEY ?? '';

export const PUT: RequestHandler = async (event) => {
	await requireScope(event, 'write');
	try {
		const body = (await event.request.json()) as {
			assetIds?: string[];
			ids?: string[];
		};
		const { fetch } = event;
		const assetIds = body.assetIds || body.ids || [];
		if (!Array.isArray(assetIds) || assetIds.length === 0) {
			throw error(400, 'assetIds required');
		}
		const albumId = await getOrCreateSystemAlbum(fetch, 'PhotoCV');
		const res = await fetch(`${IMMICH_BASE_URL}/api/albums/${albumId}/assets`, {
			method: 'PUT',
			headers: { 'x-api-key': IMMICH_API_KEY, 'Content-Type': 'application/json' },
			body: JSON.stringify({ ids: assetIds })
		});
		if (!res.ok) {
			const txt = await res.text();
			if (res.status >= 400 && res.status < 500) {
				throw error(res.status, `Failed to add assets: ${txt}`);
			}
			throw error(500, `Failed to add assets: ${txt}`);
		}
		const data = (await res.json()) as { success?: boolean };
		return json({ success: true, added: data });
	} catch (e: unknown) {
		if (e && typeof e === 'object' && 'status' in e && 'body' in e) {
			throw e;
		}
		const err = ensureError(e);
		console.error('Error in /api/people/album/assets PUT:', err);
		throw error(500, err.message);
	}
};

export const DELETE: RequestHandler = async (event) => {
	await requireScope(event, 'write');
	try {
		const body = (await event.request.json()) as {
			assetIds?: string[];
			ids?: string[];
		};
		const { fetch } = event;
		const assetIds = body.assetIds || body.ids || [];
		if (!Array.isArray(assetIds) || assetIds.length === 0) {
			throw error(400, 'assetIds required');
		}
		const albumId = await getOrCreateSystemAlbum(fetch, 'PhotoCV');
		const res = await fetch(`${IMMICH_BASE_URL}/api/albums/${albumId}/assets`, {
			method: 'DELETE',
			headers: { 'x-api-key': IMMICH_API_KEY, 'Content-Type': 'application/json' },
			body: JSON.stringify({ ids: assetIds })
		});
		if (!res.ok) {
			const txt = await res.text();
			if (res.status >= 400 && res.status < 500) {
				throw error(res.status, `Failed to remove assets: ${txt}`);
			}
			throw error(500, `Failed to remove assets: ${txt}`);
		}
		const data = (await res.json()) as { success?: boolean };
		return json({ success: true, removed: data });
	} catch (e: unknown) {
		if (e && typeof e === 'object' && 'status' in e && 'body' in e) {
			throw e;
		}
		const err = ensureError(e);
		console.error('Error in /api/people/album/assets DELETE:', err);
		throw error(500, err.message);
	}
};
