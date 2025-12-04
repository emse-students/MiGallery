import { activeOperations } from '$lib/operations';

import { toast } from '$lib/toast';
import type { PhotosState } from '$lib/photos.svelte';
import type { ImmichAsset } from '$lib/types/api';

/**
 * Upload générique de fichiers dans un album
 * Fonctionne pour les deux cas:
 * - Album Photos CV: utilise /api/people
 * - Album normal: utilise /api/albums/{id}/assets
 */
export async function handleAlbumUpload(
	files: File[],
	albumId: string,
	photosState: PhotosState,
	options: {
		onProgress?: (current: number, total: number) => void;
		// callback called after each file upload with its result
		onFileResult?: (result: { file: File; isDuplicate: boolean; assetId?: string }) => void;
		isPhotosCV?: boolean;
		onSuccess?: () => void;
	} = {}
): Promise<Array<{ file: File; isDuplicate: boolean; assetId?: string }>> {
	if (files.length === 0) {
		return [];
	}

	// Capturer les valeurs pour éviter les problèmes de proxy
	const id = albumId;
	const isPhotosCV = options.isPhotosCV === true;
	const onProgress = options.onProgress;

	const operationId = `upload-${Date.now()}`;
	activeOperations.start(operationId);

	const results: Array<{ file: File; isDuplicate: boolean; assetId?: string }> = [];

	try {
		// 1. Upload files one-by-one
		const uploadedAssets: Array<{ id?: string; assetId?: string; duplicateId?: string }> = [];

		for (let i = 0; i < files.length; i++) {
			const file = files[i];

			// Retry logic with exponential backoff
			let uploadRes: Response | null = null;
			let lastError: Error | null = null;
			const maxRetries = 3;

			for (let attempt = 0; attempt < maxRetries; attempt++) {
				try {
					const formData = new FormData();
					formData.append('assetData', file);
					formData.append('deviceAssetId', `${file.name}-${Date.now()}`);
					formData.append('deviceId', 'MiGallery-Web');
					formData.append('fileCreatedAt', new Date().toISOString());
					formData.append('fileModifiedAt', new Date().toISOString());

					uploadRes = await fetch('/api/immich/assets', {
						method: 'POST',
						body: formData
					});

					if (uploadRes.ok) {
						break; // Success, exit retry loop
					}

					// Check if it's a retryable error (5xx, timeout, etc)
					if (uploadRes.status >= 500 || uploadRes.status === 408 || uploadRes.status === 429) {
						if (attempt < maxRetries - 1) {
							// Wait with exponential backoff before retrying
							const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
							console.warn(
								`Upload attempt ${attempt + 1} failed with ${uploadRes.status}, retrying in ${delay}ms...`
							);
							await new Promise((r) => setTimeout(r, delay));
							continue;
						}
					}
					break; // Don't retry non-5xx errors
				} catch (err: unknown) {
					lastError = err instanceof Error ? err : new Error(String(err));
					if (attempt < maxRetries - 1) {
						const delay = Math.pow(2, attempt) * 1000;
						console.warn(
							`Upload attempt ${attempt + 1} failed with error, retrying in ${delay}ms...`,
							err
						);
						await new Promise((r) => setTimeout(r, delay));
					} else {
						throw err;
					}
				}
			}

			if (!uploadRes) {
				throw lastError || new Error('Upload failed: no response received');
			}

			if (!uploadRes.ok) {
				const errText = await uploadRes.text().catch(() => uploadRes.statusText);
				throw new Error(`Erreur upload: ${errText}`);
			}

			type AssetLike = { id?: string; assetId?: string; duplicateId?: string };

			const uploadResult = (await uploadRes.json()) as unknown;

			// Normaliser en tableau typé AssetLike[] pour éviter les any
			// Gérer différents formats renvoyés par Immich:
			// - { status: 'duplicate', id: '...' }
			// - { results: [...] }
			// - un tableau d'objets
			const assetsFromRes: AssetLike[] = (() => {
				try {
					if (Array.isArray(uploadResult)) {
						return uploadResult as AssetLike[];
					}

					if (uploadResult && typeof uploadResult === 'object') {
						const obj = uploadResult as Record<string, unknown>;

						// Immich may return { status: 'duplicate', id: '...' }
						if (obj.status === 'duplicate' && obj.id) {
							return [{ duplicateId: String(obj.id), id: String(obj.id) }];
						}

						// Standard wrapper: { results: [...] }
						if (Array.isArray(obj.results)) {
							return obj.results as AssetLike[];
						}

						return [uploadResult as AssetLike];
					}

					return [] as AssetLike[];
				} catch {
					return [] as AssetLike[];
				}
			})();

			// Enregistrer le résultat pour ce fichier
			const assetData = assetsFromRes[0];
			const isDup = !!assetData?.duplicateId;
			const aid = assetData?.id || assetData?.assetId;
			results.push({ file, isDuplicate: isDup, assetId: aid });
			uploadedAssets.push(...assetsFromRes);

			// Appeler le callback par-fichier si fourni
			if (options.onFileResult) {
				try {
					options.onFileResult({ file, isDuplicate: isDup, assetId: aid });
				} catch (e) {
					void e;
				}
			}

			// Appeler le callback de progression global
			if (onProgress) {
				onProgress(i + 1, files.length);
			}

			await new Promise((r) => setTimeout(r, 500));
		}

		// 2. Ajouter les assets à l'album (y compris les doublons qui ont un ID)
		const assetIds = uploadedAssets
			.map((asset) => asset.duplicateId || asset.id || asset.assetId)
			.filter(Boolean);

		if (assetIds.length > 0) {
			if (isPhotosCV) {
				// Cas Photos CV: utilise /api/people
				const addRes = await fetch('/api/people', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						action: 'add-to-album',
						assetIds
					})
				});

				if (!addRes.ok) {
					const errText = await addRes.text();
					throw new Error(`Erreur ajout à l'album: ${errText}`);
				}
			} else {
				// Cas album normal: utilise /api/albums/{id}/assets
				const addRes = await fetch(`/api/albums/${id}/assets`, {
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ ids: assetIds })
				});

				if (!addRes.ok) {
					const errText = await addRes.text();
					throw new Error(`Erreur ajout à l'album: ${errText}`);
				}
			}
		}

		// 3. Recharger l'album pour afficher les nouvelles photos
		if (isPhotosCV) {
			// Photos CV: on laisse la page utiliser sa propre logique de reload
		} else {
			// Album normal: reload via API
			const res = await fetch(`/api/albums/${id}`);
			if (res.ok) {
				const data = (await res.json()) as {
					assets?: ImmichAsset[];
				};
				photosState.assets = (data.assets || []).map((a) => ({
					id: a.id,
					originalFileName: a.originalFileName,
					type: a.type,
					date: a.fileCreatedAt || a.createdAt || a.updatedAt || null,
					_raw: a
				}));
			}
		}

		toast.success(`${files.length} fichier(s) uploadé(s) et ajouté(s) à l'album !`);
		options.onSuccess?.();

		return results;
	} catch (e: unknown) {
		console.error('Upload error:', e);
		toast.error(`Erreur lors de l'upload: ${(e as Error).message}`);
		throw e;
	} finally {
		activeOperations.end(operationId);
	}
}
