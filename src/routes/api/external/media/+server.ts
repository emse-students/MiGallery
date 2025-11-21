import { error, json } from '@sveltejs/kit';
import type { ImmichAlbum } from '$lib/types/api';
import { ensureError } from '$lib/ts-utils';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { getOrCreateSystemAlbum } from '$lib/immich/system-albums';
import { verifyRawKeyWithScope } from '$lib/db/api-keys';

const IMMICH_BASE_URL = env.IMMICH_BASE_URL;
const IMMICH_API_KEY = env.IMMICH_API_KEY;

/**
 * POST /api/external/media
 * - Upload multipart/form-data to Immich, add uploaded asset(s) to PortailEtu album
 * - Header: x-api-key: <key> (requires 'write' scope)
 * Returns: { success: true, assetIds: string[] }
 */
export const POST: RequestHandler = async ({ request, fetch }) => {
	const providedKey =
		request.headers.get('x-api-key') || request.headers.get('X-API-KEY') || undefined;
	if (!verifyRawKeyWithScope(providedKey, 'write')) {
		return json({ error: 'Unauthorized - write scope required' }, { status: 401 });
	}

	if (!IMMICH_BASE_URL) {
		throw error(500, 'IMMICH_BASE_URL not configured');
	}

	// Forward the multipart body to Immich upload endpoint
	const contentType = request.headers.get('content-type') || '';
	let body: BodyInit | undefined;
	try {
		if (contentType.includes('multipart/form-data')) {
			body = await request.arrayBuffer();
		} else {
			// accept raw body as text/json
			body = await request.text();
		}
	} catch (e: unknown) {
		const _err = ensureError(e);
		console.error('Failed to read request body for external upload', e);
		throw error(400, 'Invalid request body');
	}

	const outgoingHeaders: Record<string, string> = {
		'x-api-key': IMMICH_API_KEY || '',
		accept: 'application/json'
	};
	if (contentType) {
		outgoingHeaders['content-type'] = contentType;
	}

	const uploadRes = await fetch(`${IMMICH_BASE_URL}/api/assets`, {
		method: 'POST',
		headers: outgoingHeaders,
		body
	});

	if (!uploadRes.ok) {
		const txt = await uploadRes.text().catch(() => uploadRes.statusText);
		console.error('Immich upload failed:', txt);
		throw error(uploadRes.status, `Upload failed: ${txt}`);
	}

	const uploadJson = (await uploadRes.json().catch(() => null)) as
		| { id?: string; assets?: { id?: string }[] }
		| { id?: string }[]
		| null;
	// Try to extract asset ids from response
	let assetIds: string[] = [];
	if (Array.isArray(uploadJson)) {
		assetIds = uploadJson.map((it) => it.id).filter((id): id is string => Boolean(id));
	} else if (uploadJson?.assets && Array.isArray(uploadJson.assets)) {
		assetIds = uploadJson.assets.map((it) => it.id).filter((id): id is string => Boolean(id));
	} else if (uploadJson?.id) {
		assetIds = [uploadJson.id];
	}

	// Add assets to PortailEtu album
	try {
		const albumId = await getOrCreateSystemAlbum(fetch, 'PortailEtu');
		if (assetIds.length > 0) {
			const res = await fetch(`${IMMICH_BASE_URL}/api/albums/${albumId}/assets`, {
				method: 'PUT',
				headers: { 'x-api-key': IMMICH_API_KEY, 'Content-Type': 'application/json' },
				body: JSON.stringify({ ids: assetIds })
			});
			if (!res.ok) {
				const txt = await res.text().catch(() => res.statusText);
				console.warn('Failed to add uploaded assets to PortailEtu:', txt);
			}
		}
	} catch (e: unknown) {
		const _err = ensureError(e);
		console.warn('Failed to add assets to PortailEtu', e);
	}

	return json({ success: true, assetIds });
};

/**
 * GET /api/external/media
 * - List assets in PortailEtu album
 * - Header: x-api-key (requires 'read' scope)
 */
export const GET: RequestHandler = async ({ fetch, request }) => {
	const providedKey =
		request.headers.get('x-api-key') || request.headers.get('X-API-KEY') || undefined;
	if (!verifyRawKeyWithScope(providedKey, 'read')) {
		return json({ error: 'Unauthorized - read scope required' }, { status: 401 });
	}
	if (!IMMICH_BASE_URL) {
		throw error(500, 'IMMICH_BASE_URL not configured');
	}

	const albumId = await getOrCreateSystemAlbum(fetch, 'PortailEtu');
	const res = await fetch(`${IMMICH_BASE_URL}/api/albums/${albumId}`, {
		headers: { 'x-api-key': IMMICH_API_KEY, Accept: 'application/json' }
	});
	if (!res.ok) {
		const txt = await res.text().catch(() => res.statusText);
		throw error(res.status, `Failed to fetch album assets: ${txt}`);
	}
	const album = (await res.json()) as ImmichAlbum;
	const assets = album.assets || [];
	return json({ success: true, assets });
};

/**
 * DELETE /api/external/media
 * - Delete assets from PortailEtu album and Immich
 * - Header: x-api-key (requires 'write' scope)
 * - Body: { assetIds: string[] }
 * Returns: { success: true, deletedCount: number }
 */
export const DELETE: RequestHandler = async ({ request, fetch }) => {
	const providedKey =
		request.headers.get('x-api-key') || request.headers.get('X-API-KEY') || undefined;
	if (!verifyRawKeyWithScope(providedKey, 'write')) {
		return json({ error: 'Unauthorized - write scope required' }, { status: 401 });
	}

	if (!IMMICH_BASE_URL) {
		throw error(500, 'IMMICH_BASE_URL not configured');
	}

	let assetIds: string[] = [];
	try {
		const body = (await request.json()) as { assetIds?: string[] };
		assetIds = body.assetIds || [];
	} catch (e: unknown) {
		const _err = ensureError(e);
		throw error(400, 'Invalid request body - expected { assetIds: string[] }');
	}

	if (assetIds.length === 0) {
		return json({ error: 'No asset IDs provided' }, { status: 400 });
	}

	// Delete assets from Immich
	const deleteRes = await fetch(`${IMMICH_BASE_URL}/api/assets`, {
		method: 'DELETE',
		headers: {
			'x-api-key': IMMICH_API_KEY || '',
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({ ids: assetIds, force: true })
	});

	if (!deleteRes.ok) {
		const txt = await deleteRes.text().catch(() => deleteRes.statusText);
		console.error('Failed to delete assets from Immich:', txt);
		throw error(deleteRes.status, `Delete failed: ${txt}`);
	}

	return json({ success: true, deletedCount: assetIds.length });
};
