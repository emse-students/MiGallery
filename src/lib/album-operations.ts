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
		isPhotosCV?: boolean;
		onSuccess?: () => void;
	} = {}
) {
	if (files.length === 0) {
		return;
	}

	// Capturer les valeurs pour éviter les problèmes de proxy
	const id = albumId;
	const isPhotosCV = options.isPhotosCV === true;
	const onProgress = options.onProgress;

	const operationId = `upload-${Date.now()}`;
	activeOperations.start(operationId);

	try {
		// 1. Upload files one-by-one
		const uploadedAssets: Array<{ id?: string; assetId?: string }> = [];

		for (let i = 0; i < files.length; i++) {
			const file = files[i];

			// Mettre à jour la progression
			if (onProgress) {
				onProgress(i, files.length);
			}

			const formData = new FormData();
			formData.append('assetData', file);
			formData.append('deviceAssetId', `${file.name}-${Date.now()}`);
			formData.append('deviceId', 'MiGallery-Web');
			formData.append('fileCreatedAt', new Date().toISOString());
			formData.append('fileModifiedAt', new Date().toISOString());

			const uploadRes = await fetch('/api/immich/assets', {
				method: 'POST',
				body: formData
			});

			if (!uploadRes.ok) {
				const errText = await uploadRes.text().catch(() => uploadRes.statusText);
				throw new Error(`Erreur upload: ${errText}`);
			}

			const uploadResult = (await uploadRes.json()) as {
				results?: Array<{ id?: string; assetId?: string }>;
				id?: string;
				assetId?: string;
			};
			const assetsFromRes =
				uploadResult.results || (Array.isArray(uploadResult) ? uploadResult : [uploadResult]);
			uploadedAssets.push(...assetsFromRes);

			await new Promise((r) => setTimeout(r, 500));
		}

		// Marquer comme terminé
		if (onProgress) {
			onProgress(files.length, files.length);
		}

		// 2. Ajouter les assets à l'album
		const assetIds = uploadedAssets.map((asset) => asset.id || asset.assetId).filter(Boolean);

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
	} catch (e: unknown) {
		console.error('Upload error:', e);
		toast.error(`Erreur lors de l'upload: ${(e as Error).message}`);
	} finally {
		activeOperations.end(operationId);
	}
}
