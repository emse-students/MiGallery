import type { RequestHandler } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import { immichCache } from "$lib/server/immich-cache";

const baseUrlFromEnv = env.IMMICH_BASE_URL;
const apiKey = env.IMMICH_API_KEY;

const handle: RequestHandler = async function (event) {
	const request = event.request;
	const path = (event.params.path as string) || '';
	const search = event.url.search || '';

	let base = baseUrlFromEnv?.replace(/\/$/, '') || '';
	// ensure we have a protocol; if user provided e.g. 10.0.0.4:2283, default to http://
	if (base && !/^https?:\/\//i.test(base)) {
		base = `http://${base}`;
	}
	const remoteUrl = `${base}/api/${path}${search}`;

	if (!baseUrlFromEnv) {
		return new Response(JSON.stringify({ error: 'IMMICH_BASE_URL not set on server' }), { status: 500, headers: { 'content-type': 'application/json' } });
	}

	// Vérifier le cache pour les requêtes GET
	if (request.method === 'GET') {
		const cached = immichCache.get('GET', `/api/${path}`, remoteUrl);
		if (cached) {
			console.log(`[Cache HIT] GET /api/${path}`);
			const headers = new Headers({ 'content-type': 'application/json', 'x-cache': 'HIT' });
			return new Response(JSON.stringify(cached), { status: 200, headers });
		}
	}

	const outgoingHeaders: Record<string, string> = {
		"x-api-key": apiKey,
		// forward client's Accept header when present so we don't force JSON for images/etc
		accept: request.headers.get('accept') || '*/*',
	};

	const contentType = request.headers.get("content-type");
	
	let bodyToForward: BodyInit | undefined = undefined;
	
	if (!["GET", "HEAD"].includes(request.method)) {
		try {
			// Pour les FormData (multipart/form-data), on transmet le body brut
			if (contentType?.includes('multipart/form-data')) {
				// Transmettre le content-type avec la boundary
				outgoingHeaders["content-type"] = contentType;
				// Utiliser arrayBuffer pour préserver les données binaires
				bodyToForward = await request.arrayBuffer();
			} else {
				// Pour les autres types de contenu (JSON, etc.)
				if (contentType) outgoingHeaders["content-type"] = contentType;
				bodyToForward = await request.text();
				if (bodyToForward && !outgoingHeaders['content-length']) {
					outgoingHeaders['content-length'] = String(new TextEncoder().encode(bodyToForward).length);
				}
			}
		} catch (e) {
			console.error("Error processing request body:", e);
		}
	}

		const init: RequestInit = {
			method: request.method,
			headers: outgoingHeaders,
			body: bodyToForward,
		};

		// resolved upstream URL (used for forwarding)
		// if the client asked for endpoints/* we forward to ${base}/endpoints/..., otherwise to ${base}/api/...
		const resolvedRemoteUrl = path.startsWith("endpoints/") ? `${base}/${path}${search}` : `${base}/api/${path}${search}`;

		// production: forward without debug helpers or extra logging

	try {
		// use resolvedRemoteUrl (special-cases endpoints/*) when forwarding the request
		const res = await fetch(resolvedRemoteUrl, init);

		// log upstream errors (use clone so we don't consume the body)
		if (!res.ok) {
			try {
				const clone = res.clone();
				const snippet = await clone.text();
				console.error(`Immich proxy upstream error for ${resolvedRemoteUrl}:`, { status: res.status, statusText: res.statusText, bodySnippet: snippet && snippet.slice ? snippet.slice(0, 200) : snippet });
			} catch (e) {
				console.error('Immich proxy upstream error but failed to read body snippet', e);
			}
		}

		const contentType = res.headers.get("content-type") || "application/json";

		// Treat images, videos and archive/octet binary responses as binary so we can stream them
		const isBinary =
			contentType.startsWith("image/") ||
			contentType.startsWith("video/") ||
			contentType.startsWith("application/octet-stream") ||
			contentType.includes("zip") ||
			contentType.includes("octet-stream");

		if (isBinary) {
			const headers = new Headers();
			headers.set("content-type", contentType);
			const safeForward = ["etag", "cache-control", "expires", "x-immich-cid", "content-length"];
			for (const h of safeForward) {
				const v = res.headers.get(h);
				if (v) headers.set(h, v);
			}
			// 204 No Content ne peut pas avoir de body
			if (res.status === 204) {
				return new Response(null, { status: 204, headers });
			}
			return new Response(res.body, { status: res.status, headers });
		}

		const textBody = await res.text();
		const headers = new Headers();

		// If the upstream returned an HTML error page (eg Cloudflare 502), convert to a compact JSON
		// so the UI doesn't render huge HTML blobs as an error message.
		if (!res.ok && contentType.includes('text/html')) {
			const msg = `Upstream error ${res.status} ${res.statusText}`;
			headers.set('content-type', 'application/json');
			return new Response(JSON.stringify({ error: msg }), { status: res.status, headers });
		}

		// Mettre en cache les réponses JSON réussies pour les GET
		if (request.method === 'GET' && res.ok && contentType.includes('application/json')) {
			try {
				const jsonData = JSON.parse(textBody);
				const etag = res.headers.get('etag') || undefined;
				immichCache.set('GET', `/api/${path}`, remoteUrl, jsonData, undefined, etag);
				console.log(`[Cache SET] GET /api/${path}`);
			} catch (e) {
				// Ignore JSON parse errors
			}
		}

		// Invalider le cache après les mutations
		if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(request.method) && res.ok) {
			// Extraire les IDs des assets/albums/personnes pour invalidation ciblée
			const assetIdMatch = path.match(/assets\/([^/]+)/);
			const albumIdMatch = path.match(/albums\/([^/]+)/);
			const personIdMatch = path.match(/people\/([^/]+)/);

			if (assetIdMatch) {
				immichCache.invalidateAsset(assetIdMatch[1]);
				console.log(`[Cache INVALIDATE] Asset ${assetIdMatch[1]}`);
			}
			if (albumIdMatch) {
				immichCache.invalidateAlbum(albumIdMatch[1]);
				console.log(`[Cache INVALIDATE] Album ${albumIdMatch[1]}`);
			}
			if (personIdMatch) {
				immichCache.invalidatePerson(personIdMatch[1]);
				console.log(`[Cache INVALIDATE] Person ${personIdMatch[1]}`);
			}
		}

		headers.set("content-type", contentType);
		headers.set("x-cache", "MISS");
		const safeForward = ["etag", "cache-control", "expires", "x-immich-cid"];
		for (const h of safeForward) {
			const v = res.headers.get(h);
			if (v) headers.set(h, v);
		}

		// 204 No Content ne peut pas avoir de body
		if (res.status === 204) {
			return new Response(null, { status: 204, headers });
		}

		return new Response(textBody, { status: res.status, headers });
	} catch (err) {
		return new Response(JSON.stringify({ error: (err as Error).message }), {
			status: 502,
			headers: { "content-type": "application/json" },
		});
	}
};

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
export const PATCH = handle;
