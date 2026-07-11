import { error } from '@sveltejs/kit';
import type { ImmichAsset } from '$lib/types/api';
import { ensureError } from '$lib/ts-utils';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { getDatabase } from '$lib/db/database';
import { requireScope } from '$lib/server/permissions';
import { fetchAlbumAssets } from '$lib/immich/album-assets';
const IMMICH_BASE_URL = env.IMMICH_BASE_URL;
const IMMICH_API_KEY = env.IMMICH_API_KEY ?? '';

/**
 * GET /api/albums/[id]/assets-stream
 * Streams the metadata of an album's assets in NDJSON
 * First sends minimal metadata (id, type, dimensions) to install skeletons,
 * then progressively enriches with full details
 */
export const GET: RequestHandler = async (event) => {
	try {
		const { id } = event.params;
		const { fetch, request } = event;

		if (!IMMICH_BASE_URL) {
			throw error(500, 'IMMICH_BASE_URL not configured');
		}

		if (!IMMICH_BASE_URL) {
			throw error(500, 'IMMICH_BASE_URL not configured');
		}

		const albumHeaders: Record<string, string> = { Accept: 'application/json' };
		if (IMMICH_API_KEY) {
			albumHeaders['x-api-key'] = IMMICH_API_KEY;
		}

		let albumVisibility: string | undefined;
		try {
			const albumMetaRes = await fetch(`${IMMICH_BASE_URL}/api/albums/${id}`, {
				headers: albumHeaders
			});
			if (albumMetaRes.ok) {
				const albumMeta = (await albumMetaRes.json()) as { visibility?: string };
				albumVisibility = albumMeta.visibility;
			}
		} catch (metaErr: unknown) {
			const _metaErr = ensureError(metaErr);
			console.warn(
				'[assets-stream] failed to read album visibility metadata',
				_metaErr.message || _metaErr
			);
		}

		let visibilityHint: string | null = null;
		try {
			const parsed = new URL(request.url);
			visibilityHint = parsed.searchParams.get('visibility');
		} catch {
			visibilityHint = null;
		}
		let localVisibility: string | undefined = undefined;
		try {
			const db = getDatabase();
			const row = db.prepare('SELECT visibility FROM albums WHERE id = ?').get(id) as
				| { visibility?: string }
				| undefined;
			localVisibility = row?.visibility;
		} catch (dbErr: unknown) {
			const _dbErr = ensureError(dbErr);
			console.warn('[assets-stream] failed to read local DB visibility', _dbErr.message || _dbErr);
		}

		const isUnlisted =
			visibilityHint === 'unlisted' ||
			localVisibility === 'unlisted' ||
			albumVisibility === 'unlisted';
		if (!isUnlisted) {
			await requireScope(event, 'read');
		}

		if (!IMMICH_BASE_URL) {
			throw error(500, 'IMMICH_BASE_URL not configured');
		}

		const assets = await fetchAlbumAssets(fetch, IMMICH_BASE_URL, IMMICH_API_KEY, id);

		const encoder = new TextEncoder();
		let streamClosed = false; // Track stream state to prevent double close
		const stream = new ReadableStream({
			async start(controller) {
				const safeEnqueue = (data: string) => {
					if (streamClosed) {
						return false;
					}
					try {
						controller.enqueue(encoder.encode(data));
						return true;
					} catch (e: unknown) {
						if (
							(e as { code?: string }).code === 'ERR_INVALID_STATE' ||
							(e as Error).message?.includes('Controller is already closed')
						) {
							streamClosed = true;
							return false;
						}
						throw e;
					}
				};

				try {
					// 1. Send minimal data for all assets
					for (const asset of assets) {
						if (streamClosed) {
							break;
						}

						const exif = (asset as ImmichAsset).exifInfo as
							| { exifImageWidth?: number; exifImageHeight?: number }
							| undefined;
						const minimalData = {
							id: asset.id,
							type: asset.type,
							width: exif?.exifImageWidth ?? null,
							height: exif?.exifImageHeight ?? null,
							aspectRatio: null as number | null
						};

						if (minimalData.width && minimalData.height) {
							minimalData.aspectRatio = minimalData.width / minimalData.height;
						}

						if (
							!safeEnqueue(
								`${JSON.stringify({
									phase: 'minimal',
									asset: minimalData
								})}\n`
							)
						) {
							break;
						}
					}

					// 2. Send full details in batches
					const batchSize = 10;
					for (let i = 0; i < assets.length; i += batchSize) {
						if (streamClosed) {
							break;
						}

						const batch = assets.slice(i, i + batchSize);
						const detailsPromises = batch.map(async (asset: ImmichAsset) => {
							try {
								const detailRes = await fetch(`/api/immich/assets/${asset.id}`, {
									headers: {
										'x-internal-immich-key': IMMICH_API_KEY,
										Accept: 'application/json'
									}
								});
								if (!detailRes.ok) {
									try {
										const snippet = await detailRes.clone().text();
										console.error('[assets-stream] asset detail proxy returned non-ok', {
											assetId: asset.id,
											status: detailRes.status,
											snippet: snippet.slice(0, 400)
										});
									} catch (ie: unknown) {
										const _ie = ensureError(ie);
										console.error('[assets-stream] failed to read asset detail body', _ie.message || _ie);
									}
								}

								if (detailRes.ok) {
									const fullAsset = (await detailRes.json()) as ImmichAsset;
									return {
										phase: 'full',
										asset: fullAsset
									};
								}
								return null;
							} catch (e: unknown) {
								const _err = ensureError(e);
								console.warn(`Failed to fetch details for asset ${asset.id}:`, _err.message || _err);
								return null;
							}
						});

						const results = await Promise.allSettled(detailsPromises);

						for (const result of results) {
							if (result.status === 'fulfilled' && result.value) {
								if (!safeEnqueue(`${JSON.stringify(result.value)}\n`)) {
									break;
								}
							}
						}
					}

					if (!streamClosed) {
						streamClosed = true;
						controller.close();
					}
				} catch (err: unknown) {
					const _err = ensureError(err);
					if (
						(_err as unknown as { code?: string }).code === 'ERR_INVALID_STATE' ||
						_err.message?.includes('Controller is already closed')
					) {
						streamClosed = true;
						return;
					}
					console.error(
						'Error in assets stream (will send error message and close stream):',
						_err.message || _err
					);
					if (!streamClosed) {
						safeEnqueue(`${JSON.stringify({ phase: 'error', message: _err.message || String(_err) })}\n`);
						try {
							streamClosed = true;
							controller.close();
						} catch (e: unknown) {
							const __err = ensureError(e);
							if (
								(__err as unknown as { code?: string }).code !== 'ERR_INVALID_STATE' &&
								!__err.message?.includes('Controller is already closed')
							) {
								console.error('Failed to close stream after error:', __err.message || __err);
							}
						}
					}
				}
			}
		});

		return new Response(stream, {
			headers: {
				'Content-Type': 'application/x-ndjson',
				'Cache-Control': 'no-cache'
			}
		});
	} catch (e: unknown) {
		const _err = ensureError(e);
		console.error(`Error in /api/albums/${event.params.id}/assets-stream GET:`, _err.message || _err);
		if (e && typeof e === 'object' && 'status' in e) {
			throw e;
		}
		throw error(500, _err.message);
	}
};
