import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { getDatabase } from '$lib/db/database';
import { requireScope } from '$lib/server/permissions';
import { error } from '@sveltejs/kit';
import { ensureError } from '$lib/ts-utils';

const IMMICH_BASE_URL = env.IMMICH_BASE_URL;
const IMMICH_API_KEY = env.IMMICH_API_KEY ?? '';

export const GET: RequestHandler = async (event) => {
	try {
		const albumId = event.params.id;
		const assetId = event.params.assetId;
		const { fetch, request } = event;

		if (!IMMICH_BASE_URL) {
			throw error(500, 'IMMICH_BASE_URL not configured');
		}

		// Determine local visibility (our source of truth)
		let localVisibility: string | undefined = undefined;
		try {
			const db = getDatabase();
			const row = db.prepare('SELECT visibility FROM albums WHERE id = ?').get(albumId) as
				| { visibility?: string }
				| undefined;
			localVisibility = row?.visibility;
		} catch (dbErr: unknown) {
			const _dbErr = ensureError(dbErr);
			console.warn('[asset-original] failed to read local DB visibility', _dbErr.message || _dbErr);
		}

		const visibilityHint = (() => {
			try {
				return new URL(request.url).searchParams.get('visibility') || null;
			} catch {
				return null;
			}
		})();

		const isUnlisted = visibilityHint === 'unlisted' || localVisibility === 'unlisted';

		if (!isUnlisted) {
			// require auth or x-api-key with read scope
			await requireScope(event, 'read');
		}

		if (!IMMICH_API_KEY) {
			throw error(500, 'IMMICH_API_KEY not configured on server');
		}

		// Proxy original via internal immich proxy so we can attach the internal key
		const proxied = await fetch(`/api/immich/assets/${assetId}/original`, {
			headers: {
				'x-internal-immich-key': IMMICH_API_KEY,
				Accept: 'application/octet-stream'
			}
		});

		if (!proxied.ok) {
			let bodySnippet = '';
			try {
				bodySnippet = await proxied.clone().text();
			} catch {
				/* ignore */
			}
			console.error('[asset-original] upstream returned non-ok', {
				assetId,
				status: proxied.status,
				snippet: bodySnippet.slice(0, 400)
			});
			return new Response(bodySnippet || proxied.statusText, { status: proxied.status });
		}

		// Forward relevant headers and body stream
		const headers: Record<string, string> = {};
		const contentType = proxied.headers.get('content-type');
		if (contentType) {
			headers['content-type'] = contentType;
		}
		const contentLength = proxied.headers.get('content-length');
		if (contentLength) {
			headers['content-length'] = contentLength;
		}
		const disposition = proxied.headers.get('content-disposition');
		if (disposition) {
			headers['content-disposition'] = disposition;
		}

		return new Response(proxied.body, { status: proxied.status, headers });
	} catch (e: unknown) {
		const err = ensureError(e);
		console.error('[asset-original] error', err);
		if (e && typeof e === 'object' && 'status' in e) {
			// Re-throw objects that carry a numeric `status` so SvelteKit can handle them.
			// Cast via `unknown` -> `ErrorLike` to avoid using `any` and satisfy ESLint.
			type ErrorLike = { status: number; [key: string]: unknown };
			throw e as unknown as ErrorLike;
		}
		throw error(500, err.message);
	}
};

export const POST = GET;
export const PUT = GET;
export const DELETE = GET;
export const PATCH = GET;
