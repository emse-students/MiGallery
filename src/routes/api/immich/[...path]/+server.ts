import type { RequestHandler } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";

const baseUrlFromEnv = env.IMMICH_BASE_URL;
const apiKey = env.IMMICH_API_KEY;

const handle: RequestHandler = async function (event) {
	const request = event.request;
	const path = (event.params.path as string) || '';
	const search = event.url.search || '';

	const base = baseUrlFromEnv?.replace(/\/$/, '') || '';
	const remoteUrl = `${base}/api/${path}${search}`;

	if (!baseUrlFromEnv) {
		return new Response(JSON.stringify({ error: 'IMMICH_BASE_URL not set on server' }), { status: 500, headers: { 'content-type': 'application/json' } });
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

		headers.set("content-type", contentType);
		const safeForward = ["etag", "cache-control", "expires", "x-immich-cid"];
		for (const h of safeForward) {
			const v = res.headers.get(h);
			if (v) headers.set(h, v);
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
