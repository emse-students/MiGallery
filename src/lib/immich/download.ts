import { ensureError } from '$lib/ts-utils';
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

			// If upstream returned an archive/binary, return the blob
			const contentType = res.headers.get('content-type') || '';
			const isBinary =
				contentType.includes('zip') ||
				contentType.includes('octet-stream') ||
				contentType.startsWith('application/') ||
				contentType.startsWith('image/') ||
				contentType.startsWith('video/');

			if (res.ok && isBinary) {
				// If a progress callback was provided and the response body is a readable stream,
				// read it chunk-by-chunk and report progress.
				const onProgress = opts?.onProgress;
				const contentLengthHeader = res.headers.get('content-length');
				const total = contentLengthHeader ? Number(contentLengthHeader) : 0;

				if (onProgress && res.body && typeof ReadableStream !== 'undefined') {
					const reader = res.body.getReader();
					const chunks: Uint8Array[] = [];
					let received = 0;
					while (true) {
						const result = await reader.read();
						const { done, value } = result;
						if (done) {
							break;
						}
						if (value) {
							chunks.push(value);
							received += value.length;
							try {
								// If total is unknown (0), report -1 to indicate indeterminate progress
								onProgress(total ? Math.min(1, received / total) : -1);
							} catch (_e) {
								void _e;
								// ignore progress callback errors
							}
						}
					}
					// final progress
					try {
						onProgress(1);
					} catch (_e) {
						void _e;
						// empty
					}
					// merge chunks into a single ArrayBuffer-backed Uint8Array
					const merged = new Uint8Array(received);
					let offset = 0;
					for (const c of chunks) {
						merged.set(c, offset);
						offset += c.length;
					}
					return new Blob([merged.buffer], { type: contentType });
				}

				return await res.blob();
			}

			// non-ok -> capture error info and try next candidate
			const text = await res.text().catch(() => '');
			lastErr = new Error(`Request to ${url} failed: ${res.status} ${res.statusText} - ${text}`);
		} catch (e: unknown) {
			const _err = ensureError(e);
			lastErr = e;
		}
	}

	throw lastErr || new Error('Failed to fetch archive');
}

export function saveBlobAs(blob: Blob, filename: string) {
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 2000);
}
