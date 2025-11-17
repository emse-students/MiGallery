import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
const IMMICH_BASE_URL = env.IMMICH_BASE_URL;
const IMMICH_API_KEY = env.IMMICH_API_KEY;

/**
 * POST /api/albums/covers
 * Streaming progressif des covers d'albums via Server-Sent Events
 * 
 * Body: { albumIds: string[] }
 * Returns: Stream de { albumId: string, cover: { assetId: string, type: string } | null }
 */
export const POST: RequestHandler = async ({ request, fetch }) => {
	try {
		const { albumIds } = await request.json();
		
		if (!Array.isArray(albumIds) || albumIds.length === 0) {
			throw error(400, 'albumIds array is required');
		}

		const encoder = new TextEncoder();
		
		const stream = new ReadableStream({
			async start(controller) {
				const batchSize = 10;
				
				for (let i = 0; i < albumIds.length; i += batchSize) {
					const batch = albumIds.slice(i, i + batchSize);
					
					// Traiter le batch en parallèle
					const results = await Promise.allSettled(
						batch.map(async (albumId) => {
							try {
								if (!IMMICH_BASE_URL) {
									return { albumId, cover: null };
								}
								
								const res = await fetch(`${IMMICH_BASE_URL}/api/albums/${albumId}`, {
									headers: {
										'x-api-key': IMMICH_API_KEY,
										'Accept': 'application/json'
									}
								});

								if (res.ok) {
									const album = await res.json();
									const assets = album.assets || [];
									
									if (assets.length > 0) {
										const coverAsset = album.albumThumbnailAssetId 
											? assets.find((a: any) => a.id === album.albumThumbnailAssetId) || assets[0]
											: assets[0];
										
										return {
											albumId,
											cover: {
												assetId: coverAsset.id,
												type: coverAsset.type || 'IMAGE'
											}
										};
									}
								}
								
								return { albumId, cover: null };
							} catch (e) {
								console.warn(`Failed to fetch cover for album ${albumId}:`, e);
								return { albumId, cover: null };
							}
						})
					);
					
					// Envoyer chaque résultat immédiatement
					for (const result of results) {
						if (result.status === 'fulfilled') {
							const data = JSON.stringify(result.value) + '\n';
							controller.enqueue(encoder.encode(data));
						}
					}
				}
				
				controller.close();
			}
		});

		return new Response(stream, {
			headers: {
				'Content-Type': 'application/x-ndjson', // Newline Delimited JSON
				'Cache-Control': 'no-cache',
				'Connection': 'keep-alive'
			}
		});
	} catch (err) {
		console.error('Error in /api/albums/covers POST:', err);
		if (err && typeof err === 'object' && 'status' in err) {
			throw err;
		}
		throw error(500, err instanceof Error ? err.message : 'Internal server error');
	}
};
