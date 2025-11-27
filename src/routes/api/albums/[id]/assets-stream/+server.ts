import { error } from '@sveltejs/kit';
import type { ImmichAlbum, ImmichAsset } from '$lib/types/api';
import { ensureError } from '$lib/ts-utils';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { getDatabase } from '$lib/db/database';
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

		// Récupérer d'abord l'album (le serveur a accès à IMMICH_API_KEY)
		if (!IMMICH_BASE_URL) {
			throw error(500, 'IMMICH_BASE_URL not configured');
		}

		// Fetch album directly from Immich using server API key when available
		if (!IMMICH_BASE_URL) {
			throw error(500, 'IMMICH_BASE_URL not configured');
		}

		const albumHeaders: Record<string, string> = { Accept: 'application/json' };
		if (IMMICH_API_KEY) {
			albumHeaders['x-api-key'] = IMMICH_API_KEY;
		}

		console.debug('[assets-stream] Fetching album via internal proxy', {
			proxyUrl: `/api/immich/albums/${id}`,
			hasKey: !!IMMICH_API_KEY
		});
		// Use internal proxy but present the internal key so the proxy allows the request
		const albumRes = await fetch(`/api/immich/albums/${id}`, {
			headers: {
				'x-internal-immich-key': IMMICH_API_KEY,
				Accept: 'application/json'
			}
		});

		if (!albumRes.ok) {
			try {
				const snippet = await albumRes.clone().text();
				console.error('[assets-stream] Immich album fetch failed', {
					status: albumRes.status,
					statusText: albumRes.statusText,
					bodySnippet: snippet.slice(0, 400)
				});
			} catch (ie: unknown) {
				const _ie = ensureError(ie);
				console.error(
					'[assets-stream] Immich album fetch failed and body could not be read',
					_ie.message || _ie
				);
			}
		}

		if (!albumRes.ok) {
			const errorText = await albumRes.text();
			throw error(albumRes.status, `Failed to fetch album: ${errorText}`);
		}

		const album = (await albumRes.json()) as ImmichAlbum;
		const albumVisibility = (album as unknown as { visibility?: string }).visibility;

		console.debug('[assets-stream] album fetched', {
			id: album.id,
			visibility: albumVisibility,
			assetsCount: Array.isArray(album.assets) ? album.assets.length : 0
		});

		// Autorisation: si l'album est 'unlisted' on permet l'accès anonyme.
		// Accepter aussi le hint `visibility=unlisted` si le client le fournit (partage par lien).
		let visibilityHint: string | null = null;
		try {
			const parsed = new URL(request.url);
			visibilityHint = parsed.searchParams.get('visibility');
		} catch {
			visibilityHint = null;
		}
		if (visibilityHint) {
			console.debug('[assets-stream] visibility hint from query', visibilityHint);
		}
		// Utiliser en priorité la visibilité de la BDD locale (notre source de vérité),
		// puis fallback sur la visibilité fournie par Immich.
		let localVisibility: string | undefined = undefined;
		try {
			const db = getDatabase();
			const row = db.prepare('SELECT visibility FROM albums WHERE id = ?').get(id) as
				| { visibility?: string }
				| undefined;
			localVisibility = row?.visibility;
			console.debug('[assets-stream] localVisibility for album', { id, localVisibility });
		} catch (dbErr: unknown) {
			const _dbErr = ensureError(dbErr);
			console.warn('[assets-stream] failed to read local DB visibility', _dbErr.message || _dbErr);
		}

		const isUnlisted =
			visibilityHint === 'unlisted' ||
			localVisibility === 'unlisted' ||
			albumVisibility === 'unlisted';
		if (!isUnlisted) {
			const user = await getCurrentUser({ locals, cookies });
			if (!user) {
				const raw = request.headers.get('x-api-key') || undefined;
				if (!verifyRawKeyWithScope(raw, 'read')) {
					throw error(401, 'Unauthorized');
				}
			}
		}

		if (!IMMICH_BASE_URL) {
			throw error(500, 'IMMICH_BASE_URL not configured');
		}

		// Récupérer la liste des assets de l'album (album déjà lu ci-dessus)
		const assets = Array.isArray(album?.assets) ? album.assets : [];

		const encoder = new TextEncoder();
		const stream = new ReadableStream({
			async start(controller) {
				try {
					// Étape 1: Envoyer rapidement les métadonnées minimales pour installer les skeletons
					console.debug('[assets-stream] starting minimal phase, assets count', assets.length);
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
					console.debug('[assets-stream] starting full phase, batchSize', batchSize);
					for (let i = 0; i < assets.length; i += batchSize) {
						const batch = assets.slice(i, i + batchSize);

						const detailsPromises = batch.map(async (asset: ImmichAsset) => {
							try {
								// Fetch asset details via internal proxy and include the internal key
								console.debug('[assets-stream] fetching asset detail via proxy', { assetId: asset.id });
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
								controller.enqueue(encoder.encode(`${JSON.stringify(result.value)}\n`));
							}
						}
					}

					controller.close();
				} catch (err: unknown) {
					const _err = ensureError(err);
					console.error(
						'Error in assets stream (will send error message and close stream):',
						_err.message || _err
					);
					try {
						controller.enqueue(
							encoder.encode(
								`${JSON.stringify({ phase: 'error', message: _err.message || String(_err) })}\n`
							)
						);
					} catch (e: unknown) {
						const __err = ensureError(e);
						console.error('Failed to enqueue error message on stream:', __err.message || __err);
					}
					try {
						controller.close();
					} catch (e: unknown) {
						const __err = ensureError(e);
						console.error('Failed to close stream after error:', __err.message || __err);
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
		console.error(`Error in /api/albums/${params.id}/assets-stream GET:`, _err.message || _err);
		if (e && typeof e === 'object' && 'status' in e) {
			throw e;
		}
		throw error(500, _err.message);
	}
};
