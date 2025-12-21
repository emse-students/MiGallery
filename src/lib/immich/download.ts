import { ensureError } from '$lib/ts-utils';

/** * Types pour l'API File System Access (expérimentale)
 */
interface FileSystemWritableFileStream extends WritableStream {
	write(data: BufferSource | Blob | string): Promise<void>;
	seek(position: number): Promise<void>;
	truncate(size: number): Promise<void>;
}

interface FileSystemFileHandle {
	createWritable(options?: { keepExistingData?: boolean }): Promise<FileSystemWritableFileStream>;
}

interface SaveFilePickerOptions {
	suggestedName?: string;
	types?: Array<{
		description?: string;
		accept: Record<string, string[]>;
	}>;
}

/**
 * Types pour StreamSaver
 */

interface StreamSaverWithMitm extends StreamSaver {
	mitm?: string;
}

interface StreamSaver {
	createWriteStream(filename: string, options?: { size?: number }): WritableStream;
}

interface WindowExtended extends Window {
	showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandle>;
	streamSaver?: StreamSaver;
}

export async function fetchArchive(
	assetIds: string[],
	opts?: { filename?: string; onProgress?: (progress: number) => void; signal?: AbortSignal }
): Promise<Blob> {
	if (!Array.isArray(assetIds) || assetIds.length === 0) {
		throw new Error('assetIds must be a non-empty array');
	}

	const candidates = [
		'/api/immich/download/archive',
		'/api/immich/endpoints/download/downloadArchive'
	];

	const body = JSON.stringify({ assetIds });
	let lastErr: unknown = null;

	for (const url of candidates) {
		try {
			const res = await fetch(url, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Accept: '*/*' },
				body,
				signal: opts?.signal
			});

			const contentType = res.headers.get('content-type') || '';
			const isBinary =
				contentType.includes('zip') ||
				contentType.includes('octet-stream') ||
				contentType.startsWith('application/') ||
				contentType.startsWith('image/') ||
				contentType.startsWith('video/');

			if (res.ok && isBinary) {
				const onProgress = opts?.onProgress;
				const contentLengthHeader = res.headers.get('content-length');
				const total = contentLengthHeader ? Number(contentLengthHeader) : 0;

				if (res.body && typeof ReadableStream !== 'undefined') {
					const filename = opts?.filename || `download-${Date.now()}`;
					const win = window as unknown as WindowExtended;

					// Stratégie 1 : File System Access API (Direct vers disque, très rapide)
					if (typeof win.showSaveFilePicker === 'function') {
						try {
							const handle = await win.showSaveFilePicker({ suggestedName: filename });
							const writable = await handle.createWritable();
							const reader = res.body.getReader();
							let received = 0;
							try {
								while (true) {
									const { done, value } = await reader.read();
									if (done) {
										break;
									}
									if (value) {
										await writable.write(value);
										received += value.byteLength;
										if (onProgress) {
											try {
												onProgress(total ? Math.min(1, received / total) : -1);
											} catch {
												/* ignore progress callback errors */
											}
										}
									}
								}
								await writable.close();
								if (onProgress) {
									try {
										onProgress(1);
									} catch {
										/* ignore */
									}
								}
								return new Blob([], { type: contentType });
							} catch (err) {
								try {
									await writable.close();
								} catch {
									/* ignore failed close */
								}
								throw err;
							}
						} catch {
							// Fallthrough to other methods
						}
					}

					// Stratégie 2 : StreamSaver (Streaming via Service Worker)

					let streamSaver = win.streamSaver as StreamSaverWithMitm | undefined;
					if (!streamSaver) {
						try {
							const mod = (await import('streamsaver')) as unknown as { default: StreamSaverWithMitm };
							// prefer default export if present
							streamSaver = (mod.default || mod) as StreamSaverWithMitm;
							win.streamSaver = streamSaver;
							// If a service worker is available, hint StreamSaver to use our registered worker
							try {
								if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && streamSaver) {
									try {
										streamSaver.mitm = '/streamsaver-sw.js';
									} catch {
										// some streamSaver builds use different API names; ignore failures
									}
								}
							} catch {
								/* ignore */
							}
						} catch {
							/* fallback */
						}
					}

					if (streamSaver?.createWriteStream) {
						try {
							const fileStream = streamSaver.createWriteStream(opts?.filename || 'download', {
								size: total || undefined
							});

							const writer = (
								fileStream as unknown as { getWriter?: () => WritableStreamDefaultWriter }
							).getWriter?.();

							if (writer) {
								const reader = res.body.getReader();
								let received = 0;
								try {
									while (true) {
										const { done, value } = await reader.read();
										if (done) {
											break;
										}
										if (value) {
											await writer.write(value);
											received += value.byteLength;
											if (onProgress) {
												try {
													onProgress(total ? Math.min(1, received / total) : -1);
												} catch {
													/* ignore */
												}
											}
										}
									}
									await writer.close();
									if (onProgress) {
										try {
											onProgress(1);
										} catch {
											/* ignore */
										}
									}
									return new Blob([], { type: contentType });
								} catch (err) {
									try {
										await writer.close();
									} catch {
										/* ignore */
									}
									throw err;
								}
							} else {
								await (res.body as ReadableStream).pipeTo(fileStream);
								if (onProgress) {
									try {
										onProgress(1);
									} catch {
										/* ignore */
									}
								}
								return new Blob([], { type: contentType });
							}
						} catch {
							/* Fallthrough */
						}
					}

					// Stratégie 3 : Accumulation en mémoire optimisée
					const reader = res.body.getReader();
					const chunksIter: Uint8Array[] = [];
					let received = 0;
					while (true) {
						const { done, value } = await reader.read();
						if (done) {
							break;
						}
						if (value) {
							chunksIter.push(value);
							received += value.byteLength;
							if (onProgress) {
								try {
									onProgress(total ? Math.min(1, received / total) : -1);
								} catch {
									/* ignore */
								}
							}
							if (received > 2 * 1024 * 1024 * 1024) {
								throw new Error('Download too large for in-browser buffering');
							}
						}
					}
					if (onProgress) {
						try {
							onProgress(1);
						} catch {
							/* ignore */
						}
					}
					// Optimisation : Passer le tableau de segments directement au constructeur Blob
					// Cast en BlobPart[] pour résoudre l'erreur TS 2345 (compatibilité SharedArrayBuffer)
					return new Blob(chunksIter as unknown as BlobPart[], { type: contentType });
				}

				return await res.blob();
			}

			const text = await res.text().catch(() => '');
			lastErr = new Error(`Request to ${url} failed: ${res.status} ${res.statusText} - ${text}`);
		} catch (e) {
			lastErr = ensureError(e);
		}
	}

	throw lastErr || new Error('Failed to fetch archive');
}

export function saveBlobAs(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(() => {
		URL.revokeObjectURL(url);
	}, 2000);
}
