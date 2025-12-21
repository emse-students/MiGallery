import type { RequestHandler } from '@sveltejs/kit';
import { ensureError } from '$lib/ts-utils';
import { logEvent } from '$lib/server/logs';
import { env } from '$env/dynamic/private';
import { immichCache } from '$lib/server/immich-cache';
import { requireScope } from '$lib/server/permissions';
import { getDatabase } from '$lib/db/database';

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import NodeFormData from 'form-data';

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
				try {
					const txt = await res.text();
					console.warn(`[CheckPublic] Error body: ${txt.slice(0, 200)}`);
				} catch {
					void 0;
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

	const albums = (assetData?.albums as ImmichAlbumResponse[]) || [];

	if (assetData.albumId && !albums.find((a) => a.id === assetData?.albumId)) {
		albums.push({ id: String(assetData.albumId) });
	}

	if ((!Array.isArray(albums) || albums.length === 0) && referer) {
		const match = referer.match(/\/albums\/([a-f0-9-]{36})/);
		if (match) {
			const albumId = match[1];
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

			const assets = albumData?.assets;
			if (Array.isArray(assets)) {
				if (assets.some((a) => a.id === assetId)) {
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

		const stmt = db.prepare(
			`SELECT id FROM albums WHERE id IN (${placeholders}) AND visibility = 'unlisted' LIMIT 1`
		);
		const result = stmt.get(...albumIds) as { id: string } | undefined;

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

	const tempFilePath = path.join(os.tmpdir(), `immich_proxy_${fileId}.part`);
	const lockPath = `${tempFilePath}.lock`;
	const completePath = `${tempFilePath}.complete`;

	try {
		// obtain a quick advisory lock per fileId to avoid concurrent writers
		try {
			const fd = fs.openSync(lockPath, 'wx');
			fs.closeSync(fd);
		} catch {
			return new Response(JSON.stringify({ error: 'File currently locked, retry' }), {
				status: 409,
				headers: { 'content-type': 'application/json' }
			});
		}

		const buffer = await request.arrayBuffer();

		// verify per-chunk sha256
		try {
			const chunkSha = request.headers.get('x-chunk-sha256');
			if (chunkSha) {
				const computed = crypto.createHash('sha256').update(Buffer.from(buffer)).digest('hex');
				if (computed !== chunkSha) {
					try {
						if (fs.existsSync(lockPath)) {
							fs.unlinkSync(lockPath);
						}
					} catch {
						/* ignore */
					}
					return new Response(JSON.stringify({ error: 'Chunk hash mismatch' }), {
						status: 400,
						headers: { 'content-type': 'application/json' }
					});
				}
			}
		} catch {
			/* ignore verification errors */
		}

		try {
			if (chunkIndex === 0) {
				fs.writeFileSync(tempFilePath, Buffer.from(buffer));
			} else {
				fs.appendFileSync(tempFilePath, Buffer.from(buffer));
			}
		} finally {
			try {
				if (fs.existsSync(lockPath)) {
					fs.unlinkSync(lockPath);
				}
			} catch {
				/* ignore */
			}
		}

		if (chunkIndex < totalChunks - 1) {
			return new Response(JSON.stringify({ status: 'chunk_received', index: chunkIndex }), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			});
		}

		console.debug(`[Immich-Proxy] Réassemblage terminé pour ${fileId}, envoi à Immich...`);

		const originalName = request.headers.get('x-original-name') || `upload-${fileId}.bin`;

		// compute checksum (sha256)
		const hash = crypto.createHash('sha256');
		await new Promise<void>((resolve, reject) => {
			const rs = fs.createReadStream(tempFilePath);
			rs.on('data', (chunk) => hash.update(chunk));
			rs.on('end', () => resolve());
			rs.on('error', (err) => reject(err));
		});
		const sha256 = hash.digest('hex');

		try {
			fs.renameSync(tempFilePath, completePath);
		} catch (e) {
			console.warn('Failed to rename temp file to complete:', e);
		}

		/* eslint-disable @typescript-eslint/no-unsafe-call,@typescript-eslint/no-unsafe-member-access,@typescript-eslint/no-explicit-any */
		// Use Node `form-data` package instance. Type checks disabled because typings conflict with DOM FormData
		const formData: any = new NodeFormData();

		formData.append('assetData', fs.createReadStream(completePath), { filename: originalName });

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

		const immichUrl = `${baseUrl}/api/assets`;
		const fetchHeaders: Record<string, string> = { ...outgoingHeaders };

		const formHeaders = (formData as any).getHeaders() as Record<string, string>;
		for (const k of Object.keys(formHeaders)) {
			fetchHeaders[k] = formHeaders[k];
		}

		fetchHeaders['x-proxy-sha256'] = sha256;

		const response = await fetch(immichUrl, {
			method: 'POST',
			headers: fetchHeaders,
			body: formData as unknown as BodyInit,
			duplex: 'half'
		} as RequestInit & { duplex?: 'half' });
		/* eslint-enable @typescript-eslint/no-unsafe-call,@typescript-eslint/no-unsafe-member-access,@typescript-eslint/no-explicit-any */

		if (response.ok) {
			try {
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

		try {
			if (fs.existsSync(completePath)) {
				fs.unlinkSync(completePath);
			}
			if (fs.existsSync(tempFilePath)) {
				fs.unlinkSync(tempFilePath);
			}
		} catch (e) {
			console.warn('Failed to cleanup temp file', e);
		}

		// Forward response body but copy only safe headers (avoid forwarding content-length)
		const forwardedHeaders = new Headers();
		const safeRespForward = ['content-type', 'etag', 'cache-control', 'expires', 'x-immich-cid'];
		for (const h of safeRespForward) {
			const v = response.headers.get(h);
			if (v !== null && v !== undefined) {
				forwardedHeaders.set(h, v);
			}
		}
		return new Response(response.body, {
			status: response.status,
			headers: forwardedHeaders
		});
	} catch (err: unknown) {
		const _err = ensureError(err);
		console.error('[Immich-Proxy] Error processing chunk:', _err);
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

	if (request.method === 'GET') {
		const internalKey = request.headers.get('x-internal-immich-key') || undefined;
		if (internalKey && internalKey === apiKey) {
			void 0;
		} else {
			try {
				await requireScope(event, 'read');
			} catch (err) {
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
						void 0;
					} else {
						console.warn(`[Proxy] Access denied for asset ${assetId} (not public)`);
						return new Response(
							JSON.stringify({
								error: 'Access denied to private asset',
								assetId,
								reason: 'Asset not found in any unlisted album',
								debug: { checked: true }
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
					throw err;
				}
			}
		}
	}

	if (['PUT', 'PATCH', 'POST', 'DELETE'].includes(request.method)) {
		try {
			await requireScope(event, 'write');
		} catch (err) {
			const isDownload =
				pathParam === 'download/archive' || pathParam.includes('download/downloadArchive');

			if (request.method === 'POST' && isDownload) {
				try {
					const clone = request.clone();
					const body = (await clone.json()) as { assetIds?: string[]; ids?: string[] };
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
						void 0;
					} else {
						console.warn('[Proxy] Access denied for download (not all assets public)');
						throw err;
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

	const resolvedRemoteUrl = pathParam.startsWith('endpoints/')
		? `${base}/${pathParam}${search}`
		: `${base}/api/${pathParam}${search}`;

	if (!baseUrlFromEnv) {
		return new Response(JSON.stringify({ error: 'IMMICH_BASE_URL not set on server' }), {
			status: 500,
			headers: { 'content-type': 'application/json' }
		});
	}

	if (
		request.method === 'POST' &&
		request.headers.has('x-chunk-index') &&
		request.headers.has('x-file-id')
	) {
		const chunkHeaders: Record<string, string> = {
			accept: request.headers.get('accept') || '*/*'
		};
		if (apiKey) {
			chunkHeaders['x-api-key'] = apiKey;
		}

		return handleChunkedUpload(event, chunkHeaders, base);
	}

	if (request.method === 'GET' && event.url.searchParams.has('chunk-status')) {
		return handleChunkStatus(event);
	}

	if (request.method === 'GET') {
		const cached = immichCache.get('GET', `/api/${pathParam}`, resolvedRemoteUrl);
		if (cached) {
			const headers = new Headers({ 'content-type': 'application/json', 'x-cache': 'HIT' });
			return new Response(JSON.stringify(cached), { status: 200, headers });
		}
	}

	const outgoingHeaders: Record<string, string> = {
		accept: request.headers.get('accept') || '*/*'
	};
	if (apiKey) {
		outgoingHeaders['x-api-key'] = apiKey;
	}

	const contentType = request.headers.get('content-type');

	let bodyToForward: BodyInit | undefined = undefined;
	if (!['GET', 'HEAD'].includes(request.method)) {
		try {
			if (contentType) {
				outgoingHeaders['content-type'] = contentType;
			}
			bodyToForward = request.body ?? undefined;
		} catch (e: unknown) {
			const _err = ensureError(e);
			console.error('Error processing request body for immich proxy:', _err.message || _err);
		}
	}

	const init: RequestInit & { duplex?: 'half' } = {
		method: request.method,
		headers: outgoingHeaders,
		body: bodyToForward,
		duplex: 'half'
	};

	try {
		const res = await fetch(resolvedRemoteUrl, init);

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

		const isBinary =
			resContentType.startsWith('image/') ||
			resContentType.startsWith('video/') ||
			resContentType.startsWith('application/octet-stream') ||
			resContentType.includes('zip') ||
			resContentType.includes('octet-stream');

		if (isBinary) {
			const headers = new Headers();
			headers.set('content-type', resContentType);
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
			// Do not forward upstream Content-Length for streaming bodies — it can mismatch the proxied body.
			return new Response(res.body, { status: res.status, headers });
		}

		const textBody = await res.text();
		const headers = new Headers();

		if (!res.ok) {
			if (resContentType.includes('text/html')) {
				headers.set('content-type', 'application/json');
				return new Response(JSON.stringify({ error: `Upstream error ${res.status}` }), {
					status: res.status,
					headers
				});
			}
			if (!resContentType.includes('application/json')) {
				const snippet = textBody && textBody.slice ? textBody.slice(0, 200) : textBody;
				headers.set('content-type', 'application/json');
				return new Response(JSON.stringify({ error: snippet || `Upstream ${res.status}` }), {
					status: res.status,
					headers
				});
			}
		}

		if (request.method === 'GET' && res.ok && resContentType.includes('application/json')) {
			try {
				const jsonData: unknown = JSON.parse(textBody);
				const etag = res.headers.get('etag') || undefined;
				immichCache.set('GET', `/api/${pathParam}`, resolvedRemoteUrl, jsonData, undefined, etag);
			} catch {
				/* Ignore JSON parse errors */
			}
		}

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

		if (res.ok) {
			try {
				const assetIdMatch = pathParam.match(/assets\/([^/]+)/);
				const albumIdMatch = pathParam.match(/albums\/([^/]+)/);
				const personIdMatch = pathParam.match(/people\/([^/]+)/);

				if (request.method === 'DELETE') {
					if (pathParam === 'assets') {
						try {
							if (bodyToForward && typeof bodyToForward === 'string') {
								const parsed = JSON.parse(bodyToForward) as BulkDeleteRequest;
								if (parsed.ids && Array.isArray(parsed.ids)) {
									await logEvent(event, 'delete', 'asset', 'bulk', {
										count: parsed.ids.length,
										ids: parsed.ids
									});
								}
							}
						} catch {
							/* ignore */
						}
					} else if (assetIdMatch) {
						await logEvent(event, 'delete', 'asset', assetIdMatch[1], { proxied: true });
					} else if (albumIdMatch) {
						await logEvent(event, 'delete', 'album', albumIdMatch[1], { proxied: true });
					} else if (personIdMatch) {
						await logEvent(event, 'delete', 'person', personIdMatch[1], { proxied: true });
					}
				} else if (request.method === 'POST') {
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
						try {
							if (bodyToForward && typeof bodyToForward === 'string') {
								const parsed = JSON.parse(bodyToForward) as BulkDeleteRequest;
								if (parsed.ids) {
									await logEvent(event, 'update', 'album', albumIdMatch[1], {
										action: 'add_assets',
										count: parsed.ids.length
									});
								}
							}
						} catch {
							/* ignore */
						}
					}
				} else if (request.method === 'PUT' || request.method === 'PATCH') {
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

function handleChunkStatus(event: RequestEvent) {
	const req = event.request;
	const fileId =
		req.headers.get('x-file-id') || (event.url.searchParams.get('fileId') as string | null);
	if (!fileId) {
		return new Response(JSON.stringify({ error: 'Missing x-file-id' }), {
			status: 400,
			headers: { 'content-type': 'application/json' }
		});
	}

	const tempFilePath = path.join(os.tmpdir(), `immich_proxy_${fileId}.part`);
	const completePath = `${tempFilePath}.complete`;

	let size = 0;
	if (fs.existsSync(tempFilePath)) {
		size = fs.statSync(tempFilePath).size;
	} else if (fs.existsSync(completePath)) {
		size = fs.statSync(completePath).size;
	}

	return new Response(JSON.stringify({ exists: size > 0, receivedBytes: size }), {
		status: 200,
		headers: { 'content-type': 'application/json' }
	});
}
