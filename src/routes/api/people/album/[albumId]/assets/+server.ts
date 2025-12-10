import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import type { ImmichAlbum } from '$lib/types/api';
import { env } from '$env/dynamic/private';
import { requireScope } from '$lib/server/permissions';

const IMMICH_BASE_URL = env.IMMICH_BASE_URL;
const IMMICH_API_KEY = env.IMMICH_API_KEY;

export const GET: RequestHandler = async (event) => {
	const albumId = event.params.albumId;
	if (!albumId) {
		throw error(400, 'albumId required');
	}

	await requireScope(event, 'read');
	const { fetch } = event;

	const headers: Record<string, string> = { Accept: 'application/json' };
	if (IMMICH_API_KEY) {
		headers['x-api-key'] = IMMICH_API_KEY;
	}
	const res = await fetch(`${IMMICH_BASE_URL}/api/albums/${albumId}`, { headers });
	if (!res.ok) {
		throw error(500, `Failed to fetch album: ${res.statusText}`);
	}
	const data = (await res.json()) as ImmichAlbum;
	return json({ assets: data.assets || [] });
};

export const PUT: RequestHandler = async (event) => {
	const albumId = event.params.albumId;
	if (!albumId) {
		throw error(400, 'albumId required');
	}
	await requireScope(event, 'write');

	const body = (await event.request.json()) as Record<string, unknown>;
	const assetIds = (typeof body.assetIds !== 'undefined' ? body.assetIds : body.ids) as unknown;
	if (!Array.isArray(assetIds) || assetIds.length === 0) {
		throw error(400, 'assetIds required');
	}
	const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	if (IMMICH_API_KEY) {
		headers['x-api-key'] = IMMICH_API_KEY;
	}
	const res = await event.fetch(`${IMMICH_BASE_URL}/api/albums/${albumId}/assets`, {
		method: 'PUT',
		headers,
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
};

export const DELETE: RequestHandler = async (event) => {
	const albumId = event.params.albumId;
	if (!albumId) {
		throw error(400, 'albumId required');
	}
	await requireScope(event, 'write');

	const body = (await event.request.json()) as Record<string, unknown>;
	const assetIds = (typeof body.assetIds !== 'undefined' ? body.assetIds : body.ids) as unknown;
	if (!Array.isArray(assetIds) || assetIds.length === 0) {
		throw error(400, 'assetIds required');
	}
	const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	if (IMMICH_API_KEY) {
		headers['x-api-key'] = IMMICH_API_KEY;
	}
	const res = await event.fetch(`${IMMICH_BASE_URL}/api/albums/${albumId}/assets`, {
		method: 'DELETE',
		headers,
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
};
