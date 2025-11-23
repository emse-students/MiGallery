import { error } from '@sveltejs/kit';
import type { ImmichAlbum, ImmichAsset } from '$lib/types/api';
import { ensureError } from '$lib/ts-utils';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { verifyRawKeyWithScope } from '$lib/db/api-keys';
import { getCurrentUser } from '$lib/server/auth';
const IMMICH_BASE_URL = env.IMMICH_BASE_URL;
const IMMICH_API_KEY = env.IMMICH_API_KEY ?? '';

/**
 * GET /api/albums/[id]/assets-stream
 * Streame les métadonnées des assets d'un album en NDJSON
 * Envoie d'abord les métadonnées minimales (id, type, dimensions) pour installer les skeletons,
 * puis enrichit progressivement avec les détails complets
 */
export const GET: RequestHandler = async ({ params, fetch, request, locals, cookies }) => {
	try {
		const { id } = params;

		// Autorisation: session utilisateur OU x-api-key avec scope "read"
		const user = await getCurrentUser({ locals, cookies });
		if (!user) {
			const raw = request.headers.get('x-api-key') || undefined;
			if (!verifyRawKeyWithScope(raw, 'read')) {
				throw error(401, 'Unauthorized');
			}
		}

		if (!IMMICH_BASE_URL) {
			throw error(500, 'IMMICH_BASE_URL not configured');
		}

		// Récupérer la liste des assets de l'album
		const albumRes = await fetch(`${IMMICH_BASE_URL}/api/albums/${id}`, {
			headers: {
				'x-api-key': IMMICH_API_KEY,
				Accept: 'application/json'
			}
		});

		if (!albumRes.ok) {
			const errorText = await albumRes.text();
			throw error(albumRes.status, `Failed to fetch album: ${errorText}`);
		}

		const album = (await albumRes.json()) as ImmichAlbum;
		const assets = Array.isArray(album?.assets) ? album.assets : [];

		const encoder = new TextEncoder();
		const stream = new ReadableStream({
			async start(controller) {
				try {
					// Étape 1: Envoyer rapidement les métadonnées minimales pour installer les skeletons
					for (const asset of assets) {
						const minimalData = {
							id: asset.id,
							type: asset.type,
							// Essayer d'extraire les dimensions depuis exifInfo si disponible
							width: asset.exifInfo?.exifImageWidth || null,
							height: asset.exifInfo?.exifImageHeight || null,
							aspectRatio: null as number | null
						};

						// Calculer l'aspect ratio si possible
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

					// Étape 2: Enrichir avec les détails complets par batches
					const batchSize = 10;
					for (let i = 0; i < assets.length; i += batchSize) {
						const batch = assets.slice(i, i + batchSize);

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
					console.error('Error in assets stream:', err);
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
		console.error(`Error in /api/albums/${params.id}/assets-stream GET:`, err);
		if (e && typeof e === 'object' && 'status' in e) {
			throw e;
		}
		throw error(500, err.message);
	}
};
