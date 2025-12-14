import type { RequestHandler } from '@sveltejs/kit';
import { ensureError } from '$lib/ts-utils';
import { logEvent } from '$lib/server/logs';
import { env } from '$env/dynamic/private';
import { immichCache } from '$lib/server/immich-cache';
import { requireScope } from '$lib/server/permissions';

// Modules Node.js nécessaires pour le stockage temporaire
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const baseUrlFromEnv = env.IMMICH_BASE_URL;
const apiKey = env.IMMICH_API_KEY ?? '';

/**
 * Gère l'upload par morceaux (chunked) pour contourner les limites de Cloudflare.
 * Stocke les morceaux sur le disque et transfère le fichier complet à Immich à la fin.
 */
async function handleChunkedUpload(
	request: Request,
	outgoingHeaders: Record<string, string>,
	baseUrl: string
) {
	const chunkIndex = parseInt(request.headers.get('x-chunk-index') || '0');
	const totalChunks = parseInt(request.headers.get('x-chunk-total') || '1');
	const fileId = request.headers.get('x-file-id');

	if (!fileId) {
		return new Response(JSON.stringify({ error: 'Missing x-file-id header for chunked upload' }), {
			status: 400
		});
	}

	// Chemin temporaire unique pour ce fichier
	const tempFilePath = path.join(os.tmpdir(), `immich_proxy_${fileId}.part`);

	try {
		const buffer = await request.arrayBuffer();

		// Écriture du chunk sur le disque
		if (chunkIndex === 0) {
			fs.writeFileSync(tempFilePath, Buffer.from(buffer));
		} else {
			fs.appendFileSync(tempFilePath, Buffer.from(buffer));
		}

		// Si ce n'est pas le dernier chunk, on répond OK et on attend la suite
		if (chunkIndex < totalChunks - 1) {
			return new Response(JSON.stringify({ status: 'chunk_received', index: chunkIndex }), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			});
		}

		// --- C'est le DERNIER chunk : Assemblage et envoi à Immich ---
		console.debug(`[Immich-Proxy] Réassemblage terminé pour ${fileId}, envoi à Immich...`);

		const fileContent = fs.readFileSync(tempFilePath);
		const originalName = request.headers.get('x-original-name') || `upload-${fileId}.bin`;

		// Reconstruction du FormData attendu par Immich
		const formData = new FormData();
		const fileBlob = new Blob([fileContent], { type: 'application/octet-stream' });

		// Le champ fichier principal
		formData.append('assetData', fileBlob, originalName);

		// Ajout des métadonnées requises par Immich (envoyées via headers par le client)
		// Le client doit envoyer ces infos dans les headers de chaque chunk (ou au moins le dernier)
		const deviceId = request.headers.get('x-immich-device-id');
		const deviceAssetId = request.headers.get('x-immich-asset-id');
		const fileCreatedAt = request.headers.get('x-immich-created-at');
		const fileModifiedAt = request.headers.get('x-immich-modified-at');
		const isFavorite = request.headers.get('x-immich-is-favorite');

		if (deviceId) {
			formData.append('deviceId', deviceId);
		}
		if (deviceAssetId) {
			formData.append('deviceAssetId', deviceAssetId);
		}
		if (fileCreatedAt) {
			formData.append('fileCreatedAt', fileCreatedAt);
		}
		if (fileModifiedAt) {
			formData.append('fileModifiedAt', fileModifiedAt);
		}
		if (isFavorite) {
			formData.append('isFavorite', isFavorite);
		}

		// Préparation de l'URL Immich
		const immichUrl = `${baseUrl}/api/assets`; // Endpoint standard d'upload

		// On nettoie les headers pour l'appel fetch sortant (pas de content-type/length, fetch le gère pour FormData)
		const fetchHeaders: Record<string, string> = { ...outgoingHeaders };
		delete fetchHeaders['content-type'];
		delete fetchHeaders['content-length'];

		// Envoi à Immich
		const response = await fetch(immichUrl, {
			method: 'POST',
			headers: fetchHeaders,
			body: formData
		});

		// Nettoyage du fichier temporaire
		try {
			fs.unlinkSync(tempFilePath);
		} catch (e) {
			console.warn('Failed to cleanup temp file', e);
		}

		// Retourne la réponse d'Immich au client
		return new Response(response.body, {
			status: response.status,
			headers: response.headers
		});
	} catch (err: unknown) {
		const _err = ensureError(err);
		console.error('[Immich-Proxy] Error processing chunk:', _err);
		// Nettoyage en cas d'erreur
		try {
			if (fs.existsSync(tempFilePath)) {
				fs.unlinkSync(tempFilePath);
			}
		} catch {
			/* ignore */
		}

		return new Response(
			JSON.stringify({ error: _err.message || 'Internal Server Error processing chunk' }),
			{
				status: 500,
				headers: { 'content-type': 'application/json' }
			}
		);
	}
}

const handle: RequestHandler = async function (event) {
	const request = event.request;
	const pathParam = (event.params.path as string) || '';
	const search = event.url.search || '';

	// Autorisation pour GET: session utilisateur OU x-api-key avec scope "read"
	if (request.method === 'GET') {
		const internalKey = request.headers.get('x-internal-immich-key') || undefined;
		if (internalKey && internalKey === apiKey) {
			// Internal trusted call, allow
		} else {
			await requireScope(event, 'read');
		}
	}

	// Autorisation pour PUT/PATCH/POST/DELETE: session utilisateur requise
	if (['PUT', 'PATCH', 'POST', 'DELETE'].includes(request.method)) {
		await requireScope(event, 'write');
	}

	let base = baseUrlFromEnv?.replace(/\/$/, '') || '';
	if (base && !/^https?:\/\//i.test(base)) {
		base = `http://${base}`;
	}

	// Déterminer l'URL distante standard
	const resolvedRemoteUrl = pathParam.startsWith('endpoints/')
		? `${base}/${pathParam}${search}`
		: `${base}/api/${pathParam}${search}`;

	if (!baseUrlFromEnv) {
		return new Response(JSON.stringify({ error: 'IMMICH_BASE_URL not set on server' }), {
			status: 500,
			headers: { 'content-type': 'application/json' }
		});
	}

	// --- LOGIQUE CHUNKED UPLOAD ---
	// Si la requête est un POST vers assets ET contient les headers de chunking
	if (
		request.method === 'POST' &&
		request.headers.has('x-chunk-index') &&
		request.headers.has('x-file-id')
	) {
		// Préparer les headers de base (API Key, Accept)
		const chunkHeaders: Record<string, string> = {
			accept: request.headers.get('accept') || '*/*'
		};
		if (apiKey) {
			chunkHeaders['x-api-key'] = apiKey;
		}

		// Déléguer au handler de chunks
		return handleChunkedUpload(request, chunkHeaders, base);
	}
	// ------------------------------

	// Vérifier le cache pour les requêtes GET
	if (request.method === 'GET') {
		const cached = immichCache.get('GET', `/api/${pathParam}`, resolvedRemoteUrl);
		if (cached) {
			const headers = new Headers({ 'content-type': 'application/json', 'x-cache': 'HIT' });
			return new Response(JSON.stringify(cached), { status: 200, headers });
		}
	}

	// Build outgoing headers but only attach the API key if it's configured.
	const outgoingHeaders: Record<string, string> = {
		// forward client's Accept header when present so we don't force JSON for images/etc
		accept: request.headers.get('accept') || '*/*'
	};
	if (apiKey) {
		outgoingHeaders['x-api-key'] = apiKey;
	}

	const contentType = request.headers.get('content-type');

	// Forward the request body as a stream when possible to avoid buffering large uploads
	let bodyToForward: BodyInit | undefined = undefined;
	if (!['GET', 'HEAD'].includes(request.method)) {
		try {
			if (contentType) {
				outgoingHeaders['content-type'] = contentType;
			}

			// Special-case: for DELETE to /api/assets logging
			if (request.method === 'DELETE' && pathParam === 'assets') {
				try {
					const txt = await request.text();
					console.debug('[immich-proxy] DELETE /api/assets body:', txt);
					bodyToForward = txt;
				} catch (e: unknown) {
					const _err = ensureError(e);
					console.warn('[immich-proxy] failed to read DELETE body', _err.message);
					bodyToForward = request.body ?? undefined;
				}
			} else {
				bodyToForward = request.body ?? undefined;
			}
		} catch (e: unknown) {
			const _err = ensureError(e);
			console.error('Error processing request body for immich proxy:', _err.message || _err);
		}
	}

	// Build RequestInit for forwarding.
	const init: RequestInit & { duplex?: 'half' } = {
		method: request.method,
		headers: outgoingHeaders,
		body: bodyToForward,
		duplex: 'half'
	};

	// production: forward without debug helpers or extra logging

	try {
		const res = await fetch(resolvedRemoteUrl, init);

		// log upstream errors
		if (!res.ok) {
			try {
				const clone = res.clone();
				const snippet = await clone.text();
				console.error(`Immich proxy upstream error for ${resolvedRemoteUrl}:`, {
					status: res.status,
					statusText: res.statusText,
					bodySnippet: snippet && snippet.slice ? snippet.slice(0, 200) : snippet
				});
			} catch {
				console.error('Immich proxy upstream error but failed to read body snippet');
			}
		}

		const resContentType = res.headers.get('content-type') || 'application/json';

		// Treat images, videos and archive/octet binary responses as binary so we can stream them
		const isBinary =
			resContentType.startsWith('image/') ||
			resContentType.startsWith('video/') ||
			resContentType.startsWith('application/octet-stream') ||
			resContentType.includes('zip') ||
			resContentType.includes('octet-stream');

		if (isBinary) {
			const headers = new Headers();
			headers.set('content-type', resContentType);
			const safeForward = ['etag', 'cache-control', 'expires', 'x-immich-cid', 'content-length'];
			for (const h of safeForward) {
				const v = res.headers.get(h);
				if (v) {
					headers.set(h, v);
				}
			}
			if (res.status === 204) {
				return new Response(null, { status: 204, headers });
			}
			return new Response(res.body, { status: res.status, headers });
		}

		const textBody = await res.text();
		const headers = new Headers();

		if (!res.ok) {
			if (resContentType.includes('text/html')) {
				const msg = `Upstream error ${res.status} ${res.statusText}`;
				headers.set('content-type', 'application/json');
				return new Response(JSON.stringify({ error: msg }), { status: res.status, headers });
			}
			if (!resContentType.includes('application/json')) {
				const snippet = textBody && textBody.slice ? textBody.slice(0, 200) : textBody;
				headers.set('content-type', 'application/json');
				return new Response(
					JSON.stringify({ error: snippet || `Upstream ${res.status} ${res.statusText}` }),
					{ status: res.status, headers }
				);
			}
		}

		// Mettre en cache les réponses JSON réussies pour les GET
		if (request.method === 'GET' && res.ok && resContentType.includes('application/json')) {
			try {
				const jsonData: unknown = JSON.parse(textBody);
				const etag = res.headers.get('etag') || undefined;
				immichCache.set('GET', `/api/${pathParam}`, resolvedRemoteUrl, jsonData, undefined, etag);
			} catch {
				/* Ignore JSON parse errors */
			}
		}

		// Invalider le cache après les mutations
		if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(request.method) && res.ok) {
			const assetIdMatch = pathParam.match(/assets\/([^/]+)/);
			const albumIdMatch = pathParam.match(/albums\/([^/]+)/);
			const personIdMatch = pathParam.match(/people\/([^/]+)/);

			if (assetIdMatch) {
				immichCache.invalidateAsset(assetIdMatch[1]);
			}
			if (albumIdMatch) {
				immichCache.invalidateAlbum(albumIdMatch[1]);
			}
			if (personIdMatch) {
				immichCache.invalidatePerson(personIdMatch[1]);
			}
		}

		// Log delete events
		if (request.method === 'DELETE' && res.ok) {
			try {
				const assetIdMatch = pathParam.match(/assets\/([^/]+)/);
				const albumIdMatch = pathParam.match(/albums\/([^/]+)/);
				const personIdMatch = pathParam.match(/people\/([^/]+)/);
				if (assetIdMatch) {
					await logEvent(event, 'delete', 'asset', assetIdMatch[1], { proxied: true });
				}
				if (albumIdMatch) {
					await logEvent(event, 'delete', 'album', albumIdMatch[1], { proxied: true });
				}
				if (personIdMatch) {
					await logEvent(event, 'delete', 'person', personIdMatch[1], { proxied: true });
				}
			} catch {
				/* swallow logging errors */
			}
		}

		headers.set('content-type', resContentType);
		headers.set('x-cache', 'MISS');
		const safeForward = ['etag', 'cache-control', 'expires', 'x-immich-cid'];
		for (const h of safeForward) {
			const v = res.headers.get(h);
			if (v) {
				headers.set(h, v);
			}
		}

		if (res.status === 204) {
			return new Response(null, { status: 204, headers });
		}

		return new Response(textBody, { status: res.status, headers });
	} catch (err: unknown) {
		const _err = ensureError(err);
		return new Response(JSON.stringify({ error: _err.message }), {
			status: 502,
			headers: { 'content-type': 'application/json' }
		});
	}
};

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
export const PATCH = handle;
