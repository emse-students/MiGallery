import { json, error } from '@sveltejs/kit';

import { ensureError } from '$lib/ts-utils';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { immichCache } from '$lib/server/immich-cache';
import { requireScope } from '$lib/server/permissions';
const IMMICH_BASE_URL = env.IMMICH_BASE_URL;
const IMMICH_API_KEY = env.IMMICH_API_KEY ?? '';

/**
 * PUT /api/albums/[id]/assets
 * Ajoute des assets à un album
 *
 * Body: { ids: string[] }
 */
export const PUT: RequestHandler = async (event) => {
	await requireScope(event, 'write');
	try {
		const { id } = event.params;
		const body = (await event.request.json()) as unknown;
		const { fetch } = event;

		if (!IMMICH_BASE_URL) {
			throw error(500, 'IMMICH_BASE_URL not configured');
		}

		// A re-uploaded photo can be an Immich duplicate that currently sits in the
		// trash; adding it to an album would then never make it visible. Restore the
		// ids from trash first (no-op for assets that are not trashed).
		const ids = (body as { ids?: unknown })?.ids;
		if (Array.isArray(ids) && ids.length > 0) {
			try {
				await fetch(`${IMMICH_BASE_URL}/api/trash/restore/assets`, {
					method: 'POST',
					headers: { 'x-api-key': IMMICH_API_KEY, 'Content-Type': 'application/json' },
					body: JSON.stringify({ ids })
				});
			} catch (restoreErr) {
				// Non-fatal: still try to add even if the restore call fails.
				console.warn('[album-assets] trash restore failed (continuing):', restoreErr);
			}
		}

		const res = await fetch(`${IMMICH_BASE_URL}/api/albums/${id}/assets`, {
			method: 'PUT',
			headers: {
				'x-api-key': IMMICH_API_KEY,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(body)
		});

		if (!res.ok) {
			const errorText = await res.text();
			throw error(res.status, `Failed to add assets to album: ${errorText}`);
		}

		const result = (await res.json()) as unknown;

		immichCache.invalidateAlbum(id);

		return json(result);
	} catch (err: unknown) {
		const _err = ensureError(err);
		console.error(`Error in /api/albums/${event.params.id}/assets PUT:`, err);
		if (err && typeof err === 'object' && 'status' in err) {
			throw err;
		}
		throw error(500, err instanceof Error ? err.message : 'Internal server error');
	}
};

/**
 * DELETE /api/albums/[id]/assets
 * Retire des assets d'un album
 *
 * Body: { ids: string[] }
 */
export const DELETE: RequestHandler = async (event) => {
	await requireScope(event, 'write');
	try {
		const { id } = event.params;
		const body = (await event.request.json()) as unknown;
		const { fetch } = event;

		if (!IMMICH_BASE_URL) {
			throw error(500, 'IMMICH_BASE_URL not configured');
		}
		const res = await fetch(`${IMMICH_BASE_URL}/api/albums/${id}/assets`, {
			method: 'DELETE',
			headers: {
				'x-api-key': IMMICH_API_KEY,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(body)
		});

		if (!res.ok) {
			const errorText = await res.text();
			throw error(res.status, `Failed to remove assets from album: ${errorText}`);
		}

		const result = (await res.json()) as unknown;

		immichCache.invalidateAlbum(id);

		return json(result);
	} catch (err: unknown) {
		const _err = ensureError(err);
		console.error(`Error in /api/albums/${event.params.id}/assets DELETE:`, err);
		if (err && typeof err === 'object' && 'status' in err) {
			throw err;
		}
		throw error(500, err instanceof Error ? err.message : 'Internal server error');
	}
};
