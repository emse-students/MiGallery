import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { requireScope } from '$lib/server/permissions';

const IMMICH_BASE_URL = env.IMMICH_BASE_URL;
const IMMICH_API_KEY = env.IMMICH_API_KEY ?? '';

export const GET: RequestHandler = async (event) => {
	await requireScope(event, 'read');
	const id = event.params.id;
	const { fetch } = event;
	if (!IMMICH_BASE_URL) {
		throw error(500, 'IMMICH_BASE_URL not configured');
	}

	// Proxy thumbnail
	const res = await fetch(`${IMMICH_BASE_URL}/api/assets/${id}/thumbnail`, {
		headers: { 'x-api-key': IMMICH_API_KEY }
	});
	if (!res.ok) {
		const txt = await res.text().catch(() => res.statusText);
		return new Response(JSON.stringify({ error: `Upstream error: ${txt}` }), {
			status: res.status,
			headers: { 'content-type': 'application/json' }
		});
	}

	// Stream binary response
	const headersOut = new Headers();
	const ct = res.headers.get('content-type') || 'application/octet-stream';
	headersOut.set('content-type', ct);
	const safe = ['etag', 'cache-control', 'expires', 'content-length'];
	for (const h of safe) {
		const v = res.headers.get(h);
		if (v) {
			headersOut.set(h, v);
		}
	}

	return new Response(res.body, { status: res.status, headers: headersOut });
};

export const DELETE: RequestHandler = async (event) => {
	await requireScope(event, 'write');
	const id = event.params.id;
	const { fetch } = event;
	if (!IMMICH_BASE_URL) {
		throw error(500, 'IMMICH_BASE_URL not configured');
	}

	const res = await fetch(`${IMMICH_BASE_URL}/api/assets/${id}`, {
		method: 'DELETE',
		headers: { 'x-api-key': IMMICH_API_KEY }
	});
	if (!res.ok) {
		const txt = await res.text().catch(() => res.statusText);
		return new Response(JSON.stringify({ error: `Delete failed: ${txt}` }), {
			status: res.status,
			headers: { 'content-type': 'application/json' }
		});
	}

	return new Response(JSON.stringify({ success: true }), {
		status: 200,
		headers: { 'content-type': 'application/json' }
	});
};
