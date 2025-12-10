import { error } from '@sveltejs/kit';
import type { ImmichAsset } from '$lib/types/api';
import { ensureError } from '$lib/ts-utils';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { requireScope } from '$lib/server/permissions';
const IMMICH_BASE_URL = env.IMMICH_BASE_URL;
const IMMICH_API_KEY = env.IMMICH_API_KEY ?? '';
import { getAssetIdsInSystemAlbum } from '$lib/immich/system-albums';

/**
 * GET /api/people/people/[personId]/photos-stream
 * Streame les photos d'une personne en NDJSON
 * Phase 1: Métadonnées minimales (id, type, dimensions)
 * Phase 2: Enrichissement avec détails complets
 */
export const GET: RequestHandler = async (event) => {
	const personId = event.params.personId;
	if (!personId) {
		throw error(400, 'personId required');
	}
	const inAlbum = event.url.searchParams.get('in_album') === 'true';

	await requireScope(event, 'read');
	const { fetch } = event;
	try {
		const encoder = new TextEncoder();
		const stream = new ReadableStream({
			async start(controller) {
				try {
					// Récupérer tous les assets de la personne
					const allAssets: ImmichAsset[] = [];
					let page = 1;
					let hasNext = true;

					while (hasNext) {
						const res = await fetch(`${IMMICH_BASE_URL}/api/search/metadata`, {
							method: 'POST',
							headers: {
								'x-api-key': IMMICH_API_KEY,
								'Content-Type': 'application/json'
							},
							body: JSON.stringify({ personIds: [personId], type: 'IMAGE', page, size: 1000 })
						});

						if (!res.ok) {
							throw new Error(`Search failed: ${res.statusText}`);
						}
						const data = (await res.json()) as {
							assets?: { items?: ImmichAsset[]; nextPage?: number | null };
						};
						const items = data.assets?.items || [];
						if (items.length === 0) {
							break;
						}
						allAssets.push(...items);
						hasNext = data.assets?.nextPage !== null && data.assets?.nextPage !== undefined;
						page++;
						if (page > 10) {
							break;
						}
					}

					// Filtrer selon in_album (uniquement album PhotoCV)
					const photoCVAssetIds = new Set(await getAssetIdsInSystemAlbum(fetch, 'PhotoCV'));
					const filtered = allAssets.filter((asset) => {
						const isInPhotoCVAlbum = photoCVAssetIds.has(asset.id);
						return inAlbum ? isInPhotoCVAlbum : !isInPhotoCVAlbum;
					});

					// Phase 1: Envoyer les métadonnées minimales
					for (const asset of filtered) {
						const minimalData = {
							id: asset.id,
							type: asset.type,
							width: asset.exifInfo?.exifImageWidth || null,
							height: asset.exifInfo?.exifImageHeight || null,
							aspectRatio: null as number | null
						};

						if (minimalData.width && minimalData.height) {
							minimalData.aspectRatio = minimalData.width / minimalData.height;
						}

						controller.enqueue(
							encoder.encode(
								`${JSON.stringify({
									phase: 'minimal',
									asset: minimalData
								})}\n`
							)
						);
					}

					// Phase 2: Enrichir par batches
					const batchSize = 10;
					for (let i = 0; i < filtered.length; i += batchSize) {
						const batch = filtered.slice(i, i + batchSize);

						const detailsPromises = batch.map(async (asset: ImmichAsset) => {
							try {
								const detailRes = await fetch(`${IMMICH_BASE_URL}/api/assets/${asset.id}`, {
									headers: {
										'x-api-key': IMMICH_API_KEY,
										Accept: 'application/json'
									}
								});

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
								console.warn(`Failed to fetch details for asset ${asset.id}:`, e);
								return null;
							}
						});

						const results = await Promise.allSettled(detailsPromises);

						for (const result of results) {
							if (result.status === 'fulfilled' && result.value) {
								controller.enqueue(encoder.encode(`${JSON.stringify(result.value)}\n`));
							}
						}
					}

					controller.close();
				} catch (err: unknown) {
					const _err = ensureError(err);
					console.error('Error in photos stream:', err);
					controller.error(err);
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
		const err = ensureError(e);
		console.error('Error in /api/people/people/[personId]/photos-stream GET:', err);
		throw error(500, err.message);
	}
};
