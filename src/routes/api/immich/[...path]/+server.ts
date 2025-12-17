import type { RequestHandler } from '@sveltejs/kit';
import { ensureError } from '$lib/ts-utils';
import { logEvent } from '$lib/server/logs';
import { env } from '$env/dynamic/private';
import { immichCache } from '$lib/server/immich-cache';
import { requireScope } from '$lib/server/permissions';
import { getDatabase } from '$lib/db/database';

// Modules Node.js nécessaires pour le stockage temporaire
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const baseUrlFromEnv = env.IMMICH_BASE_URL;
const apiKey = env.IMMICH_API_KEY ?? '';

import type { RequestEvent } from '@sveltejs/kit';

interface ImmichAlbumResponse {
	id: string;
	albumName?: string;
	assets?: Array<{ id: string }>;
	[key: string]: unknown;
}

interface ImmichAssetResponse {
	id: string;
	albums?: ImmichAlbumResponse[];
	albumId?: string;
	[key: string]: unknown;
}

interface BulkDeleteRequest {
	ids: string[];
}

/**
 * Vérifie si un asset appartient à un album "unlisted" (public via lien).
 * Si oui, l'accès est autorisé même sans authentification.
 */
async function checkPublicAssetAccess(
	assetId: string,
	baseUrl: string,
	apiKey: string,
	referer?: string | null
): Promise<boolean> {
	if (!baseUrl || !apiKey) {
		console.warn('[CheckPublic] Missing baseUrl or apiKey');
		return false;
	}

	const assetUrl = `${baseUrl.replace(/\/$/, '')}/api/assets/${assetId}`;
	const cachePath = `/api/assets/${assetId}`;

	let assetData = immichCache.get('GET', cachePath, assetUrl) as ImmichAssetResponse | null;

	// Force fetch if albums is missing in cached data
	if (assetData && (!assetData.albums || !Array.isArray(assetData.albums))) {
		assetData = null; // Invalidate cache to force refresh
	}

	if (!assetData) {
		try {
			const res = await fetch(assetUrl, {
				headers: { 'x-api-key': apiKey, accept: 'application/json' }
			});
			if (!res.ok) {
				console.warn(`[CheckPublic] Fetch failed for ${assetId}: ${res.status} ${res.statusText}`);
				// Try to read body for more info
				try {
					const txt = await res.text();
					console.warn(`[CheckPublic] Error body: ${txt.slice(0, 200)}`);
				} catch {
					// ignore
				}
				return false;
			}
			assetData = (await res.json()) as ImmichAssetResponse;
			immichCache.set('GET', cachePath, assetUrl, assetData);
		} catch (e) {
			console.error('Error fetching asset details for public check:', e);
			return false;
		}
	}

	// Immich asset object has 'albums' array
	const albums = (assetData?.albums as ImmichAlbumResponse[]) || [];

	// Fallback: sometimes it might be in 'albumId' (rare for this endpoint but possible in some versions?)
	if (assetData.albumId && !albums.find((a) => a.id === assetData?.albumId)) {
		albums.push({ id: String(assetData.albumId) });
	}

	// Fallback 2: Check Referer if albums list is empty
	if ((!Array.isArray(albums) || albums.length === 0) && referer) {
		// Try to extract albumId from referer (e.g. /albums/UUID)
		const match = referer.match(/\/albums\/([a-f0-9-]{36})/);
		if (match) {
			const albumId = match[1];
			// Fetch album details to verify asset is inside
			const albumUrl = `${baseUrl.replace(/\/$/, '')}/api/albums/${albumId}`;
			const albumCacheKey = `/api/albums/${albumId}`;

			let albumData = immichCache.get('GET', albumCacheKey, albumUrl) as ImmichAlbumResponse | null;
			if (!albumData) {
				try {
					const res = await fetch(albumUrl, {
						headers: { 'x-api-key': apiKey, accept: 'application/json' }
					});
					if (res.ok) {
						albumData = (await res.json()) as ImmichAlbumResponse;
						immichCache.set('GET', albumCacheKey, albumUrl, albumData);
					}
				} catch (e) {
					console.error('Error fetching album details for referer check:', e);
				}
			}

			// Check if assetId is in this album
			// Note: ImmichAlbumResponse might need to be extended to include 'assets' property for this check
			const assets = albumData?.assets;
			if (Array.isArray(assets)) {
				if (assets.some((a) => a.id === assetId)) {
					// Found! Add this album to the list to be checked against DB
					albums.push({ id: albumId });
				}
			}
		}
	}

	if (!Array.isArray(albums) || albums.length === 0) {
		console.warn(
			`[CheckPublic] Asset ${assetId} has no albums linked in Immich response. Keys: ${Object.keys(assetData || {}).join(', ')}`
		);
		return false;
	}

	try {
		const db = getDatabase();
		const albumIds = albums.map((a) => a.id).filter((id) => !!id);
		if (albumIds.length === 0) {
			return false;
		}

		const placeholders = albumIds.map(() => '?').join(',');

		// Check if ANY of the albums is unlisted
		const stmt = db.prepare(
			`SELECT id FROM albums WHERE id IN (${placeholders}) AND visibility = 'unlisted' LIMIT 1`
		);
		const result = stmt.get(...albumIds);

		if (!result) {
			console.warn(
				`[CheckPublic] Asset ${assetId} belongs to albums [${albumIds.join(', ')}] but none are unlisted in local DB`
			);
		}

		return !!result;
	} catch (e) {
		console.error('Error checking album visibility in DB:', e);
		return false;
	}
}

/**
 * Vérifie si une liste d'assets est accessible publiquement (tous doivent être dans des albums unlisted).
 */
async function checkPublicAssetsAccess(
	assetIds: string[],
	baseUrl: string,
	apiKey: string,
	referer?: string | null
): Promise<boolean> {
	if (!assetIds || !Array.isArray(assetIds) || assetIds.length === 0) {
		return false;
	}

	// On vérifie chaque asset. Si un seul n'est pas public, on refuse tout.
	// Note: checkPublicAssetAccess utilise le cache, donc c'est performant pour les assets déjà vus.
	for (const id of assetIds) {
		const allowed = await checkPublicAssetAccess(id, baseUrl, apiKey, referer);
		if (!allowed) {
			return false;
		}
	}
	return true;
}

/**
 * Gère l'upload par morceaux (chunked) pour contourner les limites de Cloudflare.
 * Stocke les morceaux sur le disque et transfère le fichier complet à Immich à la fin.
 */
async function handleChunkedUpload(
	event: RequestEvent,
	outgoingHeaders: Record<string, string>,
	baseUrl: string
) {
	const request = event.request;
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

		// Log upload success
		if (response.ok) {
			try {
				// On essaie de récupérer l'ID de l'asset créé
				const respClone = response.clone();
				const respData = (await respClone.json()) as ImmichAssetResponse;
				const assetId = respData.id;

				if (assetId) {
					await logEvent(event, 'create', 'asset', assetId, { originalName, proxied: true });
				}
			} catch (e) {
				console.warn('Failed to log upload:', e);
			}
		}

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
			try {
				await requireScope(event, 'read');
			} catch (err) {
				// Si l'auth échoue, on vérifie si c'est une ressource publique (album unlisted)
				// Regex pour détecter les assets (thumbnail, original, preview, video)
				const assetMatch = pathParam.match(
					/^assets\/([a-f0-9-]{36})\/(thumbnail|original|preview|video\/playback)/i
				);

				if (assetMatch) {
					const assetId = assetMatch[1];
					const isPublic = await checkPublicAssetAccess(
						assetId,
						baseUrlFromEnv || '',
						apiKey,
						request.headers.get('referer')
					);
					if (isPublic) {
						// C'est public, on laisse passer (le code suivant ajoutera la clé API admin)
					} else {
						console.warn(`[Proxy] Access denied for asset ${assetId} (not public)`);
						// Return a specific error to help debugging
						return new Response(
							JSON.stringify({
								error: 'Access denied to private asset',
								assetId,
								reason: 'Asset not found in any unlisted album',
								debug: {
									checked: true
								}
							}),
							{
								status: 403,
								headers: {
									'content-type': 'application/json',
									'x-immich-proxy-reason': 'not-public-asset'
								}
							}
						);
					}
				} else {
					throw err; // Pas un asset -> on rejette
				}
			}
		}
	}

	// Autorisation pour PUT/PATCH/POST/DELETE: session utilisateur requise
	if (['PUT', 'PATCH', 'POST', 'DELETE'].includes(request.method)) {
		try {
			await requireScope(event, 'write');
		} catch (err) {
			// Exception pour le téléchargement d'archives (zip) si tous les assets sont publics
			const isDownload =
				pathParam === 'download/archive' || pathParam.includes('download/downloadArchive');

			if (request.method === 'POST' && isDownload) {
				try {
					// On doit cloner la requête pour lire le body sans le consommer pour le proxy
					const clone = request.clone();
					const body = (await clone.json()) as { assetIds?: string[]; ids?: string[] };
					// Immich envoie { assetIds: [...] }
					const assetIds = body.assetIds || body.ids || [];

					if (
						Array.isArray(assetIds) &&
						assetIds.length > 0 &&
						(await checkPublicAssetsAccess(
							assetIds,
							baseUrlFromEnv || '',
							apiKey,
							request.headers.get('referer')
						))
					) {
						// Autorisé ! On continue vers le proxy.
					} else {
						console.warn('[Proxy] Access denied for download (not all assets public)');
						throw err; // Rejet si pas public
					}
				} catch (e) {
					console.error('Error checking public download access:', e);
					throw err;
				}
			} else {
				throw err;
			}
		}
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
		return handleChunkedUpload(event, chunkHeaders, base);
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
			// DISABLED: Reading the body here consumes the stream and can cause issues if not handled perfectly.
			// For now, we skip logging the body content to ensure reliability.
			/*
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
			*/
			bodyToForward = request.body ?? undefined;
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

		// Log events
		if (res.ok) {
			try {
				const assetIdMatch = pathParam.match(/assets\/([^/]+)/);
				const albumIdMatch = pathParam.match(/albums\/([^/]+)/);
				const personIdMatch = pathParam.match(/people\/([^/]+)/);

				// DELETE
				if (request.method === 'DELETE') {
					// Bulk delete assets
					if (pathParam === 'assets') {
						try {
							let ids: string[] = [];
							if (bodyToForward && typeof bodyToForward === 'string') {
								const parsed = JSON.parse(bodyToForward) as BulkDeleteRequest;
								if (parsed.ids && Array.isArray(parsed.ids)) {
									ids = parsed.ids;
								}
							}
							if (ids.length > 0) {
								await logEvent(event, 'delete', 'asset', 'bulk', { count: ids.length, ids });
							}
						} catch {
							/* ignore parse error */
						}
					} else if (assetIdMatch) {
						// Single delete
						await logEvent(event, 'delete', 'asset', assetIdMatch[1], { proxied: true });
					} else if (albumIdMatch) {
						await logEvent(event, 'delete', 'album', albumIdMatch[1], { proxied: true });
					} else if (personIdMatch) {
						await logEvent(event, 'delete', 'person', personIdMatch[1], { proxied: true });
					}
				} else if (request.method === 'POST') {
					// POST (Create)
					// Create Album
					if (pathParam === 'albums') {
						try {
							const respData = JSON.parse(textBody) as ImmichAlbumResponse;
							if (respData.id) {
								await logEvent(event, 'create', 'album', respData.id, { name: respData.albumName });
							}
						} catch {
							/* ignore */
						}
					} else if (albumIdMatch && pathParam.endsWith('/assets')) {
						// Add assets to album
						try {
							let count = 0;
							if (bodyToForward && typeof bodyToForward === 'string') {
								const parsed = JSON.parse(bodyToForward) as BulkDeleteRequest;
								if (parsed.ids && Array.isArray(parsed.ids)) {
									count = parsed.ids.length;
								}
							}
							await logEvent(event, 'update', 'album', albumIdMatch[1], { action: 'add_assets', count });
						} catch {
							/* ignore */
						}
					}
				} else if (request.method === 'PUT' || request.method === 'PATCH') {
					// PUT/PATCH (Update)
					if (albumIdMatch) {
						await logEvent(event, 'update', 'album', albumIdMatch[1], { method: request.method });
					}
				}
			} catch (e) {
				console.warn('Logging failed in proxy:', e);
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
