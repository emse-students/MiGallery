import { activeOperations } from '$lib/operations';
import { toast } from '$lib/toast';
import { m } from '$lib/paraglide/messages';
import type { PhotosState } from '$lib/photos.svelte';
import { buildImmichUploadFormData } from '$lib/immich/upload';

const CHUNK_SIZE = 1024 * 1024 * 5; // 5MB
const SIMPLE_UPLOAD_THRESHOLD = 1024 * 1024 * 10; // 10MB

/**
 * Derive a stable, server-safe upload id from the file's identity so a retry
 * reuses the same server-side partial (data/chunk-uploads/*.part) and resumes
 * instead of re-uploading from chunk 0. Must match the proxy's allowed id
 * charset: [a-zA-Z0-9._-].
 */
async function computeStableFileId(file: File): Promise<string> {
	const key = `${file.name}-${file.size}-${file.lastModified}`;
	try {
		const subtle = globalThis.crypto?.subtle;
		if (subtle) {
			const ab = new TextEncoder().encode(key);
			const digest = await subtle.digest('SHA-256', ab);
			return Array.from(new Uint8Array(digest))
				.map((b) => b.toString(16).padStart(2, '0'))
				.join('');
		}
	} catch {
		/* fall through to a sanitized key */
	}
	return key.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function isOffline(): boolean {
	return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/**
 * Resolve once the browser reports it is back online, or after timeoutMs.
 * Returns true if connectivity returned, false on timeout.
 */
function waitForOnline(timeoutMs: number): Promise<boolean> {
	if (!isOffline()) {
		return Promise.resolve(true);
	}
	return new Promise((resolve) => {
		let settled = false;
		const finish = (value: boolean) => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timer);
			if (typeof window !== 'undefined') {
				window.removeEventListener('online', onOnline);
			}
			resolve(value);
		};
		const onOnline = () => finish(true);
		const timer = setTimeout(() => finish(false), timeoutMs);
		if (typeof window !== 'undefined') {
			window.addEventListener('online', onOnline);
		}
	});
}

async function uploadFileSimple(file: File, signal?: AbortSignal): Promise<Response> {
	const formData = new FormData();
	const fileCreatedAt = new Date().toISOString();
	const fileModifiedAt = new Date().toISOString();

	buildImmichUploadFormData(formData, {
		file,
		createdAt: fileCreatedAt,
		modifiedAt: fileModifiedAt
	});

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
	const fileId = await computeStableFileId(file);
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
			// Explicit Content-Type: a Blob from file.slice() has an empty type, so
			// without this the request carries no Content-Type and adapter-node does
			// not expose its body to the handler (chunk reads come back empty -> 502).
			'Content-Type': 'application/octet-stream',
			'x-chunk-index': String(chunkIndex),
			'x-chunk-total': String(totalChunks),
			'x-file-id': fileId,
			'x-original-name': encodeURIComponent(file.name),
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
 * Generic file upload into an album
 * Works for both cases:
 * - Photos CV album: uses /api/people
 * - Normal album: uses /api/albums/{id}/assets
 */
export async function handleAlbumUpload(
	files: File[],
	albumId: string,
	photosState: PhotosState,
	options: {
		onProgress?: (current: number, total: number) => void;
		onFileResult?: (result: { file: File; isDuplicate: boolean; assetId?: string }) => void;
		onFileStart?: (file: File) => void;
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

			// Signal that this file is now the active upload so the UI can flip it
			// from the pending queue to an in-progress state.
			if (options.onFileStart) {
				try {
					options.onFileStart(file);
				} catch (e) {
					void e;
				}
			}

			let uploadRes: Response | null = null;
			let lastError: Error | null = null;
			const maxServerRetries = 3; // exponential-backoff retries for 5xx / timeouts
			const OFFLINE_WAIT_MS = 60_000; // how long to wait for reconnection per cycle
			const maxOfflineWaits = 20; // hard cap so a dropped connection never loops forever
			let serverAttempt = 0;
			let offlineWaits = 0;

			while (true) {
				// If the browser is offline, wait for reconnection instead of burning
				// server retries. The stable fileId lets the next attempt resume from
				// the last chunk the server already has.
				if (isOffline()) {
					if (offlineWaits++ >= maxOfflineWaits) {
						throw lastError || new Error('Upload aborted: connection lost');
					}
					console.warn('Connection lost, waiting for reconnection before resuming upload...');
					await waitForOnline(OFFLINE_WAIT_MS);
					continue;
				}

				try {
					uploadRes = await uploadFileChunked(file);

					if (uploadRes.ok) {
						break; // Success
					}

					if (uploadRes.status >= 500 || uploadRes.status === 408 || uploadRes.status === 429) {
						if (serverAttempt < maxServerRetries - 1) {
							const delay = Math.pow(2, serverAttempt) * 1000; // 1s, 2s, 4s
							serverAttempt++;
							console.warn(
								`Upload failed with ${uploadRes.status}, retrying in ${delay}ms (attempt ${serverAttempt}/${maxServerRetries})...`
							);
							await new Promise((r) => setTimeout(r, delay));
							continue;
						}
					}
					break; // Non-retriable status or out of server retries
				} catch (err: unknown) {
					lastError = err instanceof Error ? err : new Error(String(err));
					// A network-level failure while offline: loop back and wait for
					// reconnection (does not consume a server retry).
					if (isOffline()) {
						continue;
					}
					if (serverAttempt < maxServerRetries - 1) {
						const delay = Math.pow(2, serverAttempt) * 1000;
						serverAttempt++;
						console.warn(
							`Upload failed with error, retrying in ${delay}ms (attempt ${serverAttempt}/${maxServerRetries})...`,
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
				throw new Error(`Upload error: ${errText}`);
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
					console.warn(`Error adding asset ${aid} to album:`, addErr);
				}
			}

			if (onProgress) {
				onProgress(i + 1, files.length);
			}

			await new Promise((r) => setTimeout(r, 500));
		}

		toast.success(m.upload_album_success({ count: files.length }));

		if (options.onSuccess) {
			await options.onSuccess();
		}

		return results;
	} catch (e: unknown) {
		console.error('Upload error:', e);
		toast.error(m.upload_error_long({ message: (e as Error).message }));
		throw e;
	} finally {
		activeOperations.end(operationId);
	}
}
