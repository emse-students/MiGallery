import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import type { ImmichAlbum } from '$lib/types/api';
import type { Cookies } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getCurrentUser } from '$lib/server/auth';
import { verifyRawKeyWithScope } from '$lib/db/api-keys';

const IMMICH_BASE_URL = env.IMMICH_BASE_URL;
const IMMICH_API_KEY = env.IMMICH_API_KEY;

async function isAuthorized(
	request: Request,
	locals: App.Locals,
	cookies: Cookies,
	requiredScope?: string
) {
	// Prefer API key
	const apiKey = request.headers.get('x-api-key') || request.headers.get('X-API-KEY');
	if (apiKey) {
		if (verifyRawKeyWithScope(apiKey, requiredScope)) {
			return { by: 'api-key' };
		}
		return null;
	}

	// Else check session user
	const user = await getCurrentUser({ locals, cookies });
	if (!user) {
		return null;
	}
	const role = user.role || 'user';
	if (role === 'admin') {
		return { by: 'user', user };
	}
	if (requiredScope === 'write' && role === 'mitviste') {
		return { by: 'user', user };
	}
	// Other roles default to no
	return null;
}

export const GET: RequestHandler = async ({ params, fetch, request, locals, cookies }) => {
	const albumId = params.albumId;
	if (!albumId) {
		throw error(400, 'albumId required');
	}

	// Autorisation: session utilisateur OU x-api-key avec scope "read"
	const auth = await isAuthorized(request, locals, cookies, 'read');
	if (!auth) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

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

export const PUT: RequestHandler = async ({ params, request, fetch, locals, cookies }) => {
	const albumId = params.albumId;
	if (!albumId) {
		throw error(400, 'albumId required');
	}
	const auth = await isAuthorized(request, locals, cookies, 'write');
	if (!auth) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const body = (await request.json()) as Record<string, unknown>;
	const assetIds = (typeof body.assetIds !== 'undefined' ? body.assetIds : body.ids) as unknown;
	if (!Array.isArray(assetIds) || assetIds.length === 0) {
		throw error(400, 'assetIds required');
	}
	const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	if (IMMICH_API_KEY) {
		headers['x-api-key'] = IMMICH_API_KEY;
	}
	const res = await fetch(`${IMMICH_BASE_URL}/api/albums/${albumId}/assets`, {
		method: 'PUT',
		headers,
		body: JSON.stringify({ ids: assetIds })
	});
	if (!res.ok) {
		const txt = await res.text();
		throw error(500, `Failed to add assets: ${txt}`);
	}
	const data = (await res.json()) as { success?: boolean };
	return json({ success: true, added: data });
};

export const DELETE: RequestHandler = async ({ params, request, fetch, locals, cookies }) => {
	const albumId = params.albumId;
	if (!albumId) {
		throw error(400, 'albumId required');
	}
	const auth = await isAuthorized(request, locals, cookies, 'write');
	if (!auth) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const body = (await request.json()) as Record<string, unknown>;
	const assetIds = (typeof body.assetIds !== 'undefined' ? body.assetIds : body.ids) as unknown;
	if (!Array.isArray(assetIds) || assetIds.length === 0) {
		throw error(400, 'assetIds required');
	}
	const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	if (IMMICH_API_KEY) {
		headers['x-api-key'] = IMMICH_API_KEY;
	}
	const res = await fetch(`${IMMICH_BASE_URL}/api/albums/${albumId}/assets`, {
		method: 'DELETE',
		headers,
		body: JSON.stringify({ ids: assetIds })
	});
	if (!res.ok) {
		const txt = await res.text();
		throw error(500, `Failed to remove assets: ${txt}`);
	}
	const data = (await res.json()) as { success?: boolean };
	return json({ success: true, removed: data });
};
