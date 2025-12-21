import { activeOperations } from '$lib/operations';
import { toast } from '$lib/toast';
import type { PhotosState } from '$lib/photos.svelte';

const CHUNK_SIZE = 1024 * 1024 * 5; // 5MB
const SIMPLE_UPLOAD_THRESHOLD = 1024 * 1024 * 10; // 10MB

async function uploadFileSimple(file: File, signal?: AbortSignal): Promise<Response> {
	const formData = new FormData();
	const deviceAssetId = `${file.name}-${Date.now()}`;
	const deviceId = 'MiGallery-Web';
	const fileCreatedAt = new Date().toISOString();
	const fileModifiedAt = new Date().toISOString();

	formData.append('assetData', file);
	formData.append('deviceId', deviceId);
	formData.append('deviceAssetId', deviceAssetId);
	formData.append('fileCreatedAt', fileCreatedAt);
	formData.append('fileModifiedAt', fileModifiedAt);

	return await fetch('/api/immich/assets', {
		method: 'POST',
		body: formData,
		signal
	});
}

export async function uploadFileChunked(file: File, signal?: AbortSignal): Promise<Response> {
	if (file.size < SIMPLE_UPLOAD_THRESHOLD) {
		return uploadFileSimple(file, signal);
	}

	const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
	const fileId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
	const deviceAssetId = `${file.name}-${Date.now()}`;
	const deviceId = 'MiGallery-Web';
	const fileCreatedAt = new Date().toISOString();
	const fileModifiedAt = new Date().toISOString();

	let lastResponse: Response | null = null;

	// Check server for existing partial upload to resume
	let startChunk = 0;
	try {
		const statusRes = await fetch('/api/immich/assets?chunk-status=1', {
			method: 'GET',
			headers: { 'x-file-id': fileId }
		});
		if (statusRes.ok) {
			const json = (await statusRes.json().catch(() => null)) as { receivedBytes?: number } | null;
			if (json && typeof json.receivedBytes === 'number' && json.receivedBytes > 0) {
				startChunk = Math.floor(json.receivedBytes / CHUNK_SIZE);
			}
		}
	} catch {
		// ignore resume check errors and start from zero
	}

	for (let chunkIndex = startChunk; chunkIndex < totalChunks; chunkIndex++) {
		const start = chunkIndex * CHUNK_SIZE;
		const end = Math.min(start + CHUNK_SIZE, file.size);
		const chunk = file.slice(start, end);

		const headers: Record<string, string> = {
			'x-chunk-index': String(chunkIndex),
			'x-chunk-total': String(totalChunks),
			'x-file-id': fileId,
			'x-original-name': file.name,
			'x-immich-device-id': deviceId,
			'x-immich-asset-id': deviceAssetId,
			'x-immich-created-at': fileCreatedAt,
			'x-immich-modified-at': fileModifiedAt
		};

		// compute per-chunk checksum (SHA-256) to allow server-side verification
		try {
			const subtle = globalThis.crypto?.subtle;
			if (subtle && chunk && chunk.size > 0) {
				const ab = await chunk.arrayBuffer();
				const digest = await subtle.digest('SHA-256', ab);
				const view = new Uint8Array(digest);
				const hex = Array.from(view)
					.map((b) => b.toString(16).padStart(2, '0'))
					.join('');
				headers['x-chunk-sha256'] = hex;
			}
		} catch {
			/* ignore chunk hash errors */
		}

		const res = await fetch('/api/immich/assets', {
			method: 'POST',
			headers,
			body: chunk,
			signal
		});

		if (!res.ok) {
			const text = await res.text();
			throw new Error(`Chunk ${chunkIndex + 1}/${totalChunks} failed: ${res.status} ${text}`);
		}

		lastResponse = res;
	}

	if (!lastResponse) {
		throw new Error('No response from chunked upload');
	}
	return lastResponse;
}

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
		onFileResult?: (result: { file: File; isDuplicate: boolean; assetId?: string }) => void;
		isPhotosCV?: boolean;
		onSuccess?: () => void;
	} = {}
): Promise<Array<{ file: File; isDuplicate: boolean; assetId?: string }>> {
	if (files.length === 0) {
		return [];
	}

	const id = albumId;
	const isPhotosCV = options.isPhotosCV === true;
	const onProgress = options.onProgress;

	const operationId = `upload-${Date.now()}`;
	activeOperations.start(operationId);

	const results: Array<{ file: File; isDuplicate: boolean; assetId?: string }> = [];

	try {
		for (let i = 0; i < files.length; i++) {
			const file = files[i];

			let uploadRes: Response | null = null;
			let lastError: Error | null = null;
			const maxRetries = 3;

			for (let attempt = 0; attempt < maxRetries; attempt++) {
				try {
					uploadRes = await uploadFileChunked(file);

					if (uploadRes.ok) {
						break; // Success, exit retry loop
					}

					if (uploadRes.status >= 500 || uploadRes.status === 408 || uploadRes.status === 429) {
						if (attempt < maxRetries - 1) {
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

			const assetsFromRes: AssetLike[] = (() => {
				try {
					if (Array.isArray(uploadResult)) {
						return uploadResult as AssetLike[];
					}

					if (uploadResult && typeof uploadResult === 'object') {
						const obj = uploadResult as Record<string, unknown>;

						if (obj.status === 'duplicate' && obj.id) {
							return [{ duplicateId: String(obj.id), id: String(obj.id) }];
						}

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

			const assetData = assetsFromRes[0];
			const isDup = !!assetData?.duplicateId;
			const aid = assetData?.id || assetData?.assetId;
			results.push({ file, isDuplicate: isDup, assetId: aid });

			if (options.onFileResult) {
				try {
					options.onFileResult({ file, isDuplicate: isDup, assetId: aid });
				} catch (e) {
					void e;
				}
			}

			if (aid) {
				const assetIdToAdd = aid;
				try {
					if (isPhotosCV) {
						await fetch('/api/people', {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({
								action: 'add-to-album',
								assetIds: [assetIdToAdd]
							})
						});
					} else {
						await fetch(`/api/albums/${id}/assets`, {
							method: 'PUT',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({ ids: [assetIdToAdd] })
						});
					}
				} catch (addErr: unknown) {
					console.warn(`Erreur lors de l'ajout de l'asset ${aid} à l'album:`, addErr);
				}
			}

			if (onProgress) {
				onProgress(i + 1, files.length);
			}

			await new Promise((r) => setTimeout(r, 500));
		}

		toast.success(`${files.length} fichier(s) uploadé(s) et ajouté(s) à l'album !`);

		if (options.onSuccess) {
			await options.onSuccess();
		}

		return results;
	} catch (e: unknown) {
		console.error('Upload error:', e);
		toast.error(`Erreur lors de l'upload: ${(e as Error).message}`);
		throw e;
	} finally {
		activeOperations.end(operationId);
	}
}
